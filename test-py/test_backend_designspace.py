import pathlib
import shutil

import pytest
from fontTools.designspaceLib import DesignSpaceDocument

from fontra.backends.designspace import DesignspaceBackend, UFOBackend
from fontra.core.classes import Layer, Source, StaticGlyph

dataDir = pathlib.Path(__file__).resolve().parent / "data"


@pytest.fixture
def writableTestFont(tmpdir):
    mutatorPath = dataDir / "mutatorsans"
    for sourcePath in mutatorPath.iterdir():
        if sourcePath.suffix not in {".designspace", ".ufo"}:
            continue
        destPath = tmpdir / sourcePath.name
        if sourcePath.is_dir():
            shutil.copytree(sourcePath, destPath)
        else:
            shutil.copy(sourcePath, destPath)
    return DesignspaceBackend.fromPath(tmpdir / "MutatorSans.designspace")


@pytest.fixture
def writableTestFontSingleUFO(tmpdir):
    sourcePath = dataDir / "mutatorsans" / "MutatorSansLightCondensed.ufo"
    destPath = tmpdir / sourcePath.name
    shutil.copytree(sourcePath, destPath)
    return UFOBackend.fromPath(destPath)


def readGLIFData(glyphName, ufoLayers):
    glyphSets = {layer.fontraLayerName: layer.glyphSet for layer in ufoLayers}
    return {
        layerName: glyphSet.getGLIF(glyphName).decode("utf-8")
        for layerName, glyphSet in glyphSets.items()
        if glyphName in glyphSet
    }


@pytest.mark.parametrize("glyphName", ["A", "B", "Q", "varcotest1", "varcotest2"])
async def test_roundTripGlyph(writableTestFont, glyphName):
    existingData = readGLIFData(glyphName, writableTestFont.ufoLayers)
    glyphMap = await writableTestFont.getGlyphMap()
    glyph = await writableTestFont.getGlyph(glyphName)

    await writableTestFont.putGlyph(glyphName, glyph, glyphMap[glyphName])

    newData = readGLIFData(glyphName, writableTestFont.ufoLayers)
    for layerName in existingData:
        assert existingData[layerName] == newData[layerName], layerName
    assert existingData == newData  # just in case the keys differ


@pytest.mark.parametrize("glyphName", ["A"])
async def test_roundTripGlyphSingleUFO(writableTestFontSingleUFO, glyphName):
    existingData = readGLIFData(glyphName, writableTestFontSingleUFO.ufoLayers)
    glyphMap = await writableTestFontSingleUFO.getGlyphMap()
    glyph = await writableTestFontSingleUFO.getGlyph(glyphName)

    await writableTestFontSingleUFO.putGlyph(glyphName, glyph, glyphMap[glyphName])

    newData = readGLIFData(glyphName, writableTestFontSingleUFO.ufoLayers)
    for layerName in existingData:
        assert existingData[layerName] == newData[layerName], layerName
    assert existingData == newData  # just in case the keys differ


async def test_addNewSparseSource(writableTestFont):
    glyphName = "A"
    glyphMap = await writableTestFont.getGlyphMap()
    glyph = await writableTestFont.getGlyph(glyphName)
    dsSources = unpackSources(writableTestFont.dsDoc.sources)

    glyph.sources.append(Source(name="mid", location={"weight": 400}, layerName="mid"))
    glyph.layers["mid"] = Layer(glyph=StaticGlyph())

    await writableTestFont.putGlyph(glyphName, glyph, glyphMap[glyphName])

    newDSDoc = DesignSpaceDocument.fromfile(writableTestFont.dsDoc.path)
    newDSSources = unpackSources(newDSDoc.sources)
    assert dsSources == newDSSources[: len(dsSources)]
    assert len(newDSSources) == len(dsSources) + 1
    assert newDSSources[-1] == dict(
        location=dict(weight=400, width=0),
        styleName="mid",
        filename="MutatorSansLightCondensed.ufo",
        layerName="mid",
    )


async def test_addNewDenseSource(writableTestFont):
    glyphName = "A"
    assert writableTestFont.dsDoc.axes[0].name == "width"

    # Move the width axis maximum
    writableTestFont.dsDoc.axes[0].maximum = 1500
    writableTestFont.__init__(writableTestFont.dsDoc)  # hacky reload from ds doc

    glyphMap = await writableTestFont.getGlyphMap()
    glyph = await writableTestFont.getGlyph(glyphName)
    dsSources = unpackSources(writableTestFont.dsDoc.sources)

    glyph.sources.append(
        Source(name="widest", location={"width": 1500}, layerName="widest")
    )
    glyph.layers["widest"] = Layer(glyph=StaticGlyph())

    await writableTestFont.putGlyph(glyphName, glyph, glyphMap[glyphName])

    newDSDoc = DesignSpaceDocument.fromfile(writableTestFont.dsDoc.path)
    newDSSources = unpackSources(newDSDoc.sources)
    assert dsSources == newDSSources[: len(dsSources)]
    assert len(newDSSources) == len(dsSources) + 1
    assert newDSSources[-1] == dict(
        location=dict(weight=150, width=1500),
        styleName="widest",
        filename="MutatorSans_widest.ufo",
        layerName="public.default",
    )


def unpackSources(sources):
    return [
        {k: getattr(s, k) for k in ["location", "styleName", "filename", "layerName"]}
        for s in sources
    ]
