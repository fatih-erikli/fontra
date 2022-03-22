import asyncio
import aiohttp
from fontTools.ufoLib.glifLib import readGlyphFromString
from .pen import PathBuilderPointPen
from .rcjkclient import Client as RCJKClient, HTTPError


class RCJKClientAsync(RCJKClient):
    def _connect(self):
        # Override with no-op, as we need to handle the connection separately
        # as an async method.
        pass

    async def connect(self):
        self._session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(verify_ssl=False)
        )
        session = await self._session.__aenter__()
        assert session is self._session

        try:
            # check if there are robocjk apis available at the given host
            response = await self._api_call("ping")
            assert response["data"] == "pong"
        except Exception as e:
            # invalid host
            raise ValueError(
                f"Unable to call RoboCJK APIs at host: {self._host} - Exception: {e}"
            )

        # obtain the auth token to prevent 401 error on first call
        await self.auth_token()

    async def close(self):
        await self._session.__aexit__(None, None, None)

    async def get_project_font_uid_mapping(self):
        project_font_uid_mapping = {}
        for project_item in (await self.project_list())["data"]:
            project_name = project_item["name"]
            project_uid = project_item["uid"]
            for font_item in (await self.font_list(project_uid))["data"]:
                font_name = font_item["name"]
                font_uid = font_item["uid"]
                project_font_uid_mapping[project_name, font_name] = (
                    project_uid,
                    font_uid,
                )
        return project_font_uid_mapping

    async def _api_call(self, view_name, params=None):
        url, data, headers = self._prepare_request(view_name, params)
        async with self._session.post(url, data=data, headers=headers) as response:
            if response.status == 401:
                # unauthorized - request a new auth token
                await self.auth_token()
                if self._auth_token:
                    # re-send previously unauthorized request
                    return await self._api_call(view_name, params)
            # read response json data and return dict
            response_data = await response.json()
            if response.status != 200:
                raise HTTPError(f"{response.status} {response_data['error']}")
        return response_data

    async def auth_token(self):
        """
        Get an authorization token for the current user.
        """
        params = {
            "username": self._username,
            "password": self._password,
        }
        response = await self._api_call("auth_token", params)
        # update auth token
        self._auth_token = response.get("data", {}).get("auth_token", self._auth_token)
        return response


class RCJKMySQLBackend:
    @classmethod
    async def fromRCJKClient(cls, client, fontUID):
        self = cls()
        self.client = client
        self.fontUID = fontUID

        self._glyphMapping = None
        self._tempGlyphDataCache = {}
        self._tempGlyphDataCacheTimer = None
        self._tempGlyphDataCacheTimeout = 5
        return self

    async def getGlyphNames(self):
        return sorted(await self.getReverseCmap())

    async def getReverseCmap(self):
        self._glyphMapping = {}
        revCmap = {}
        for typeCode, methodName in _glyphListMethods.items():
            method = getattr(self.client, methodName)
            response = await method(self.fontUID)
            for glyphInfo in response["data"]:
                unicode_hex = glyphInfo.get("unicode_hex")
                if unicode_hex:
                    unicodes = [int(unicode_hex, 16)]
                else:
                    unicodes = []
                revCmap[glyphInfo["name"]] = unicodes
                self._glyphMapping[glyphInfo["name"]] = (typeCode, glyphInfo["id"])
        return revCmap

    async def getGlyph(self, glyphName):
        typeCode, glyphID = self._glyphMapping[glyphName]
        glyphData = self._tempGlyphDataCache.get((typeCode, glyphID))
        if glyphData is None:
            getMethodName = _getGlyphMethods[typeCode]
            method = getattr(self.client, getMethodName)
            response = await method(
                self.fontUID, glyphID, return_layers=True, return_related=True
            )
            glyphData = response["data"]
            self._tempGlyphDataCache[(typeCode, glyphID)] = glyphData

        self._cacheBaseGlyphData(glyphData.get("made_of", ()))
        axisDefaults = {}
        for baseGlyphDict in glyphData.get("made_of", ()):
            axisDefaults.update(extractAxisDefaults(baseGlyphDict))

        layers = {layer["group_name"]: layer for layer in glyphData.get("layers", ())}
        self._scheduleCachePurge()
        return serializeGlyph(glyphData["data"], layers, axisDefaults)

    async def getGlobalAxes(self):
        font_data = await self.client.font_get(self.fontUID)
        ds = font_data["data"].get("designspace", {})
        axes = ds.get("axes", [])
        for axis in axes:
            axis["label"] = axis["name"]
            axis["name"] = axis["tag"]
            del axis["tag"]
        return axes

    def _scheduleCachePurge(self):
        if self._tempGlyphDataCacheTimer is not None:
            self._tempGlyphDataCacheTimer.cancel()

        async def purgeGlyphCache():
            await asyncio.sleep(self._tempGlyphDataCacheTimeout)
            # print("clearing temp glyph cache")
            self._tempGlyphDataCache.clear()

        self._tempGlyphDataCacheTimer = asyncio.create_task(purgeGlyphCache())

    def _cacheBaseGlyphData(self, baseGlyphs):
        for glyphDict in baseGlyphs:
            typeCode, glyphID = self._glyphMapping[glyphDict["name"]]
            assert typeCode == glyphDict["type_code"]
            assert glyphID == glyphDict["id"]
            self._tempGlyphDataCache[(typeCode, glyphID)] = glyphDict
            # No need to recurse into glyphDict["made_of"], as getGlyph
            # does that for us.


def serializeGlyph(glifData, layers, axisDefaults):
    glyph = GLIFGlyph()
    pen = PathBuilderPointPen()
    readGlyphFromString(glifData, glyph, pen)

    defaultSourceDict = {
        "xAdvance": glyph.width,
    }
    defaultPath = pen.getPath()
    if defaultPath:
        defaultSourceDict["path"] = defaultPath

    defaultComponents = serializeComponents(
        glyph.lib.get("robocjk.deepComponents", ()), None, axisDefaults, None
    )
    dcNames = [c["name"] for c in defaultComponents]
    components = defaultComponents or pen.components
    componentNames = [c["name"] for c in components]
    if components:
        defaultSourceDict["components"] = components

    sources = [
        {
            "name": "<default>",
            "location": {},
            "layerName": "<default>/foreground",
        },
    ]
    layerData = [{"name": "<default>/foreground", "glyph": defaultSourceDict}]
    neutralComponentLocations = [compo["location"] for compo in components]

    for varDict in glyph.lib.get("robocjk.variationGlyphs", ()):
        if not varDict.get("on", True):
            continue
        varSourceDict = {}
        layerName = varDict.get("layerName")
        xAdvance = glyph.width
        if defaultPath and layerName and layerName in layers:
            varGlyph = GLIFGlyph()
            pen = PathBuilderPointPen()
            readGlyphFromString(layers[layerName]["data"], varGlyph, pen)
            xAdvance = varGlyph.width
            varPath = pen.getPath()
            if varPath:
                varSourceDict["path"] = varPath
        varComponents = serializeComponents(
            varDict.get("deepComponents", ()),
            dcNames,
            axisDefaults,
            neutralComponentLocations,
        )
        varComponents = varComponents or pen.components
        assert componentNames == [c["name"] for c in varComponents]
        if varComponents:
            varSourceDict["components"] = varComponents
        xAdvance = varDict["width"] if "width" in varDict else xAdvance
        varSourceDict["xAdvance"] = xAdvance
        sourceName = varDict.get("sourceName")
        if not sourceName and layerName:
            sourceName = f"{layerName}"
        sources.append(
            {
                "name": sourceName,
                "location": varDict["location"],
                "layerName": f"{sourceName}/foreground",
            }
        )
        layerData.append({"name": f"{sourceName}/foreground", "glyph": varSourceDict})

    glyphDict = {
        "name": glyph.name,
        "unicodes": glyph.unicodes,
        "axes": [cleanupAxis(axis) for axis in glyph.lib["robocjk.axes"]],
        "sources": sources,
        "layers": layerData,
    }
    return glyphDict


def serializeComponents(
    deepComponents, dcNames, axisDefaults, neutralComponentLocations
):
    if dcNames is not None:
        assert len(deepComponents) == len(dcNames)
    components = []
    for index, deepCompoDict in enumerate(deepComponents):
        component = {}
        name = deepCompoDict["name"] if "name" in deepCompoDict else dcNames[index]
        component["name"] = name
        if deepCompoDict["coord"]:
            component["location"] = cleanupLocation(
                deepCompoDict["coord"],
                axisDefaults[name],
                neutralComponentLocations[index]
                if neutralComponentLocations is not None
                else {},
            )
        component["transformation"] = deepCompoDict["transform"]
        components.append(component)
    return components


def cleanupLocation(location, axisDefaults, neutralLocation):
    return {
        a: location.get(a, neutralLocation.get(a, v)) for a, v in axisDefaults.items()
    }


def cleanupAxis(axisDict):
    axisDict = dict(axisDict)
    minValue = axisDict["minValue"]
    maxValue = axisDict["maxValue"]
    defaultValue = axisDict.get("defaultValue", minValue)
    minValue, maxValue = sorted([minValue, maxValue])
    axisDict["minValue"] = minValue
    axisDict["defaultValue"] = defaultValue
    axisDict["maxValue"] = maxValue
    return axisDict


class GLIFGlyph:
    unicodes = ()
    width = 0


_getGlyphMethods = {
    "AE": "atomic_element_get",
    "DC": "deep_component_get",
    "CG": "character_glyph_get",
}


_glyphListMethods = {
    "AE": "atomic_element_list",
    "DC": "deep_component_list",
    "CG": "character_glyph_list",
}


def extractAxisDefaults(baseGlyphDict):
    axisDefaults = {}
    glyph = GLIFGlyph()
    readGlyphFromString(baseGlyphDict["data"], glyph)
    axisDefaults[glyph.name] = {
        a["name"]: a["defaultValue"] for a in glyph.lib.get("robocjk.axes", ())
    }

    # handle nested made_of glyphs
    for subGlyphDict in baseGlyphDict.get("made_of", ()):
        axisDefaults.update(extractAxisDefaults(subGlyphDict))

    return axisDefaults
