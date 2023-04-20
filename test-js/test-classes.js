import chai from "chai";
const expect = chai.expect;

import { enumerate, range } from "../src/fontra/client/core/utils.js";
import classesSchema from "../src/fontra/client/core/classes.json" assert { type: "json" };
import { getClassSchema } from "../src/fontra/client/core/classes.js";
import {
  Layer,
  StaticGlyph,
  VariableGlyph,
} from "../src/fontra/client/core/var-glyph.js";
import { VarPackedPath } from "../src/fontra/client/core/var-path.js";

describe("schema tests", () => {
  const testPaths = [
    [["unitsPerEm", "int"]],
    [
      ["glyphs", "dict<VariableGlyph>"],
      ["<anything>", "VariableGlyph"],
      ["sources", "list<Source>"],
      [999, "Source"],
      ["location", "dict<float>"],
      ["<anything>", "float"],
    ],
    [
      ["glyphs", "dict<VariableGlyph>"],
      ["<anything>", "VariableGlyph"],
      ["layers", "list<Layer>"],
      [999, "Layer"],
      ["glyph", "StaticGlyph"],
      ["path", "PackedPath"],
      ["pointTypes", "list<PointType>"],
      [999, "PointType"],
    ],
    [
      ["glyphs", "dict<VariableGlyph>"],
      ["<anything>", "VariableGlyph"],
      ["layers", "list<Layer>"],
      [999, "Layer"],
      ["glyph", "StaticGlyph"],
      ["components", "list<Component>"],
      [999, "Component"],
      ["location", "dict<float>"],
      ["<anything>", "float"],
    ],
    [["nonExistingProperty", null]],
  ];

  for (const [testIndex, testPath] of enumerate(testPaths)) {
    it(`test path ${testIndex}`, async () => {
      const schema = await getClassSchema(classesSchema);
      let subjectType = schema["Font"]; // Root
      expect(subjectType.className).to.equal("Font");
      expect(subjectType.compositeName).to.equal("Font");
      for (const [pathElement, expectedName] of testPath) {
        if (expectedName) {
          subjectType = subjectType.getSubType(pathElement);
          expect(subjectType.compositeName).to.equal(expectedName);
        } else {
          expect(() => {
            subjectType.getSubType(pathElement);
          }).to.throw("Unknown subType nonExistingProperty of Font");
        }
      }
    });
  }

  const castTestCases = [
    { rootClass: "Font", path: ["unitsPerEm"], inValue: 123, outValue: 123 },
    {
      rootClass: "Font",
      path: ["glyphs", "A"],
      inValue: { name: "A", sources: [], layers: [] },
      outValue: VariableGlyph.fromObject({ name: "A", sources: [], layers: [] }),
    },
    {
      rootClass: "Font",
      path: ["glyphs"],
      inValue: { A: { name: "A", axes: [], sources: [], layers: [] } },
      outValue: {
        A: VariableGlyph.fromObject({ name: "A", axes: [], sources: [], layers: [] }),
      },
    },
    {
      rootClass: "StaticGlyph",
      path: [],
      inValue: { xAdvance: 500 },
      outValue: StaticGlyph.fromObject({
        xAdvance: 500,
        path: { coordinates: [], pointTypes: [], contourInfo: [] },
      }),
    },
    {
      rootClass: "StaticGlyph",
      path: ["path"],
      inValue: {
        coordinates: [],
        pointTypes: [],
        contourInfo: [],
      },
      outValue: VarPackedPath.fromObject({
        coordinates: [],
        pointTypes: [],
        contourInfo: [],
      }),
    },
    {
      rootClass: "VariableGlyph",
      path: ["layers"],
      inValue: [{ name: "default", glyph: {} }],
      outValue: [Layer.fromObject({ name: "default", glyph: {} })],
    },
  ];

  for (const [testIndex, testCase] of enumerate(castTestCases)) {
    it(`cast test ${testIndex}`, async () => {
      const schema = await getClassSchema(classesSchema);
      let subjectType = schema[testCase.rootClass]; // Root
      for (const pathElement of testCase.path) {
        subjectType = subjectType.getSubType(pathElement);
      }
      const castValue = subjectType.cast(testCase.inValue);
      expect(castValue.constructor).to.equal(testCase.outValue.constructor);
      expect(castValue).to.deep.equal(testCase.outValue);
      if (Array.isArray(testCase.outValue)) {
        expect(testCase.outValue.length).to.equal(castValue.length);
        for (const i of range(castValue.length)) {
          const castItem = castValue[i];
          const outItem = testCase.outValue[i];
          expect(castItem.constructor).to.equal(outItem.constructor);
          expect(castItem).to.deep.equal(outItem);
        }
      } else if (testCase.outValue.constructor === Object) {
        for (const [k, outItem] of Object.entries(testCase.outValue)) {
          const castItem = castValue[k];
          expect(castItem.constructor).to.equal(outItem.constructor);
          expect(castItem).to.deep.equal(outItem);
        }
      }
    });
  }
});
