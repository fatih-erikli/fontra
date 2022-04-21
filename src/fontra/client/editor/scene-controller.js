import { applyChange, consolidateChanges } from "../core/changes.js";
import { glyphChangeFunctions } from "../core/font-controller.js";
import { MouseTracker } from "../core/mouse-tracker.js";
import { centeredRect, normalizeRect } from "../core/rectangle.js";
import { lenientIsEqualSet, isEqualSet, isSuperset, union, symmetricDifference } from "../core/set-ops.js";


export class SceneController {

  constructor(sceneModel, canvasController) {
    this.sceneModel = sceneModel;
    this.canvasController = canvasController;

    this.mouseTracker = new MouseTracker({
      drag: async (eventStream, initialEvent) => this.handleDrag(eventStream, initialEvent),
      hover: event => this.handleHover(event),
      element: canvasController.canvas,
    });
    this._eventElement = document.createElement("div");
  }

  addEventListener(eventName, handler, options) {
    this._eventElement.addEventListener(eventName, handler, options);
  }

  _dispatchEvent(eventName, detail) {
    const event = new CustomEvent(eventName, {
      "bubbles": false,
      "detail": detail || this,
    });
    this._eventElement.dispatchEvent(event);
  }

  getSelectedGlyphName() {
    return this.sceneModel.getSelectedGlyphName();
  }

  getSelectedGlyphIndex() {
    return this.sceneModel.getSelectedGlyphIndex();
  }

  async handleDrag(eventStream, initialEvent) {
    const point = this.localPoint(initialEvent);
    const selection = this.sceneModel.selectionAtPoint(point, this.mouseClickMargin);
    if (initialEvent.detail >= 2 || initialEvent.myTapCount >= 2) {
      this.handleDoubleCick(selection, point);
      initialEvent.preventDefault();  // don't let our dbl click propagate to other elements
      return;
    }

    if (!this.sceneModel.selectedGlyphIsEditing) {
      this.selectedGlyph = this.sceneModel.glyphAtPoint(point);
      this.selectedGlyphIsEditing = false;
      return;
    }

    const initialSelection = this.selection;
    let initiateDrag = false;
    let initiateRectSelect = false;

    if (selection.size > 0) {
      if (event.shiftKey) {
        this.selection = symmetricDifference(this.selection, selection);
        if (isSuperset(this.selection, selection)) {
          initiateDrag = true;
        }
      } else if (isSuperset(this.selection, selection)) {
        initiateDrag = true;
      } else {
        this.selection = selection;
        initiateDrag = true;
      }
    } else {
      if (!event.shiftKey) {
        this.selection = selection;
      }
      initiateRectSelect = true;
    }

    if (initiateRectSelect || initiateDrag) {
      if (!await shouldInitiateDrag(eventStream, initialEvent)) {
        initiateRectSelect = false;
        initiateDrag = false;
        const selectedGlyph = this.sceneModel.glyphAtPoint(point);
        if (selectedGlyph && selectedGlyph != this.selectedGlyph) {
          this.selectedGlyph = selectedGlyph;
          this.selectedGlyphIsEditing = false;
          return;
        }
      }
    }

    this.hoveredGlyph = undefined;

    if (initiateRectSelect) {
      return await this.handleRectSelect(eventStream, initialEvent, initialSelection);
    }
    if (initiateDrag) {
      return await this.handleDragSelection(eventStream, initialEvent);
    }
  }

  handleDoubleCick(selection, point) {
    if (!selection || !selection.size) {
      this.selectedGlyph = this.sceneModel.glyphAtPoint(point);
      this.selectedGlyphIsEditing = !!this.selectedGlyph;
    } else {
      const instance = this.sceneModel.getSelectedPositionedGlyph().glyph.instance;
      const componentNames = new Set();
      for (const selItem of this.selection) {
        const [tp, index] = selItem.split("/");
        if (tp === "component") {
          componentNames.add(instance.components[index].name);
        }
      }
      if (componentNames.size) {
        this.doubleClickedComponentNames = Array.from(componentNames);
        this._dispatchEvent("doubleClickedComponents");
      }
    }
  }

  async handleRectSelect(eventStream, initialEvent, initialSelection) {
    const initialPoint = this.localPoint(initialEvent);
    for await (const event of eventStream) {
      const currentPoint = this.localPoint(event);
      const selRect = normalizeRect({
        "xMin": initialPoint.x,
        "yMin": initialPoint.y,
        "xMax": currentPoint.x,
        "yMax": currentPoint.y,
      });
      const selection = this.sceneModel.selectionAtRect(selRect);
      this.selectionRect = selRect;

      if (event.shiftKey) {
        this.selection = symmetricDifference(initialSelection, selection);
      } else {
        this.selection = selection;
      }
    }
    this.selectionRect = undefined;
  }

  async handleDragSelection(eventStream, initialEvent) {
    const initialPoint = this.localPoint(initialEvent);
    const glyphController = this.sceneModel.getSelectedPositionedGlyph().glyph;
    if (!glyphController.canEdit) {
      console.log(`can't edit glyph '${glyphController.name}': location is not a source`);
      return;
    }
    const sourceIndex = glyphController.sourceIndex;
    const fontController = this.sceneModel.fontController;
    const glyphName = glyphController.name;
    const instance = glyphController.instance;

    const varGlyph = await fontController.getGlyph(glyphName);
    const layerIndex = varGlyph.getLayerIndex(varGlyph.sources[sourceIndex].layerName);
    const baseChangePath = ["glyphs", glyphName, "layers", layerIndex, "glyph"];

    const editor = new EditBehavior(instance, this.selection);
    let change, absChange;
    await fontController.changeBegin();
    await fontController.changeSetRollback(consolidateChanges(editor.rollbackChange, baseChangePath));

    for await (const event of eventStream) {
      const currentPoint = this.localPoint(event);
      const delta = {"x": currentPoint.x - initialPoint.x, "y": currentPoint.y - initialPoint.y};
      change = editor.makeChangeForDelta(delta);
      absChange = consolidateChanges(change, baseChangePath);
      await fontController.changeChanging(absChange);
      applyChange(instance, change, glyphChangeFunctions);
      await fontController.glyphChanged(glyphName);
      await this.sceneModel.updateScene();
      this.canvasController.setNeedsUpdate();
    }

    const error = await fontController.changeEnd(absChange);
    if (error) {
      applyChange(instance, editor.rollbackChange, glyphChangeFunctions);
      await fontController.glyphChanged(glyphName);
      await this.sceneModel.updateScene();
      this.canvasController.setNeedsUpdate();
    }
  }

  handleHover(event) {
    const point = this.localPoint(event);
    const size = this.mouseClickMargin;
    const selRect = centeredRect(point.x, point.y, size);
    this.hoverSelection = this.sceneModel.selectionAtPoint(point, size);
    this.hoveredGlyph = this.sceneModel.glyphAtPoint(point);
    if (this.hoverSelection?.size) {
      this.canvasController.canvas.style.cursor = "pointer";
    } else {
      this.canvasController.canvas.style.cursor = "default";
    }
  }

  localPoint(event) {
    if (event.x !== undefined) {
      this._currentLocalPoint = this.canvasController.localPoint(event);
    }
    return this._currentLocalPoint;
  }

  get onePixelUnit() {
    return this.canvasController.onePixelUnit;
  }

  get mouseClickMargin() {
    return this.canvasController.drawingParameters.cornerNodeSize;
  }

  get selection() {
    return this.sceneModel.selection;
  }

  set selection(selection) {
    if (!lenientIsEqualSet(selection, this.selection)) {
      this.sceneModel.selection = selection;
      this.canvasController.setNeedsUpdate();
      this._dispatchEvent("selectionChanged");
    }
  }

  get hoverSelection() {
    return this.sceneModel.hoverSelection;
  }

  set hoverSelection(selection) {
    if (!lenientIsEqualSet(selection, this.hoverSelection)) {
      this.sceneModel.hoverSelection = selection;
      this.canvasController.setNeedsUpdate();
    }
  }

  get hoveredGlyph() {
    return this.sceneModel.hoveredGlyph;
  }

  set hoveredGlyph(hoveredGlyph) {
    if (this.sceneModel.hoveredGlyph != hoveredGlyph) {
      this.sceneModel.hoveredGlyph = hoveredGlyph;
      this.canvasController.setNeedsUpdate();
    }
  }

  get selectedGlyph() {
    return this.sceneModel.selectedGlyph;
  }

  set selectedGlyph(selectedGlyph) {
    if (this.sceneModel.selectedGlyph != selectedGlyph) {
      this.sceneModel.selectedGlyph = selectedGlyph;
      this.sceneModel.selection = new Set();
      this.canvasController.setNeedsUpdate();
      this._dispatchEvent("selectedGlyphChanged");
    }
  }

  get selectedGlyphIsEditing() {
    return this.sceneModel.selectedGlyphIsEditing;
  }

  set selectedGlyphIsEditing(flag) {
    if (this.sceneModel.selectedGlyphIsEditing != flag) {
      this.sceneModel.selectedGlyphIsEditing = flag;
      this.canvasController.setNeedsUpdate();
      this._dispatchEvent("selectedGlyphIsEditingChanged");
    }
  }

  get selectionRect() {
    return this.sceneModel.selectionRect;
  }

  set selectionRect(selRect) {
    this.sceneModel.selectionRect = selRect;
    this.canvasController.setNeedsUpdate();
  }

  getGlyphLines() {
    return this.sceneModel.getGlyphLines();
  }

  async setGlyphLines(glyphLines) {
    for await (const _ of this.sceneModel.setGlyphLines(glyphLines, true)) {
      this.canvasController.setNeedsUpdate();
    }
  }

  getLocation() {
    return this.sceneModel.getLocation();
  }

  async setLocation(values) {
    await this.sceneModel.setLocation(values);
    this.canvasController.setNeedsUpdate();
  }

  getSelectedSource() {
    return this.sceneModel.getSelectedSource();
  }

  async setSelectedSource(sourceIndex) {
    await this.sceneModel.setSelectedSource(sourceIndex);
    this.canvasController.setNeedsUpdate();
  }

  getAxisInfo() {
    return this.sceneModel.getAxisInfo();
  }

  getSourcesInfo() {
    return this.sceneModel.getSourcesInfo();
  }

}


const MINIMUM_DRAG_DISTANCE = 2;


async function shouldInitiateDrag(eventStream, initialEvent) {
  // drop events until the pointer moved a minimal distance
  const initialX = initialEvent.pageX;
  const initialY = initialEvent.pageY;

  for await (const event of eventStream) {
    const x = event.pageX;
    const y = event.pageY;
    if (
      Math.abs(initialX - x) > MINIMUM_DRAG_DISTANCE ||
      Math.abs(initialY - y) > MINIMUM_DRAG_DISTANCE
    ) {
      return true;
    }
  }
  return false;
}


function makeRollbackChange(instance, selection) {
  const path = instance.path;
  const components = instance.components;

  const rollbacks = mapSelection(selection,
    {
      "point": pointIndex => {
        const point = path.getPoint(pointIndex);
        return makePointChange(pointIndex, point.x, point.y);
      },
      "component": componentIndex => {
        const t = components[componentIndex].transformation;
        return makeComponentOriginChange(componentIndex, t.x, t.y);
      },
    }
  );
  const changes = [];
  if (rollbacks["point"]) {
    changes.push(consolidateChanges(rollbacks["point"], ["path"]));
  }
  if (rollbacks["component"]) {
    changes.push(consolidateChanges(rollbacks["component"], ["components"]));
  }
  return consolidateChanges(changes);
}


class EditBehavior {

  constructor(instance, selection) {
    this.instance = instance;
    this.selection = selection;
    this.setupEditFuncs();
    this.rollbackChange = makeRollbackChange(instance, selection);
  }

  setupEditFuncs() {
    const path = this.instance.path;
    const components = this.instance.components;
    const editFuncs = [];

    this.editFuncs = mapSelection(this.selection,
      {
        "point": pointIndex => makePointDragFunc(path, pointIndex),
        "component": componentIndex => makeComponentDragFunc(components, componentIndex),
      }
    );
  }

  makeChangeForDelta(delta) {
    const pathChanges = this.editFuncs["point"]?.map(
      editFunc => makePointChange(...editFunc(delta))
    );
    const componentChanges = this.editFuncs["component"]?.map(
      editFunc => makeComponentOriginChange(...editFunc(delta))
    );
    const changes = [];
    if (pathChanges && pathChanges.length) {
      changes.push(consolidateChanges(pathChanges, ["path"]));
    }
    if (componentChanges && componentChanges.length) {
      changes.push(consolidateChanges(componentChanges, ["components"]));
    }
    return consolidateChanges(changes);
  }

}


function makePointDragFunc(path, pointIndex) {
  const point = path.getPoint(pointIndex);
  return delta => [pointIndex, point.x + delta.x, point.y + delta.y];
}


function makeComponentDragFunc(components, componentIndex) {
  const x = components[componentIndex].transformation.x;
  const y = components[componentIndex].transformation.y;
  return delta => [componentIndex, x + delta.x, y + delta.y];
}


function makePointChange(pointIndex, x, y) {
  return {"f": "=xy", "k": pointIndex, "a": [x, y]};
}


function makeComponentOriginChange(componentIndex, x, y) {
  return {
    "p": [componentIndex, "transformation"],
    "c": [{"f": "=", "k": "x", "v": x}, {"f": "=", "k": "y", "v": y}],
  };
}


function mapSelection(selection, funcs) {
  const result = {};
  for (const selItem of selection) {
    let [tp, index] = selItem.split("/");
    index = Number(index);
    const f = funcs[tp];
    if (f !== undefined) {
      if (!(tp in result)) {
        result[tp] = [];
      }
      result[tp].push(f(index));
    }
  }
  return result;
}