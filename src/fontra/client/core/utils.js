import { Transform } from "./transform.js";

export function objectsEqual(obj1, obj2) {
  // Shallow object compare. Arguments may be null or undefined
  if (!obj1 || !obj2) {
    return obj1 === obj2;
  }
  const keys = Object.keys(obj1);
  if (keys.length !== Object.keys(obj2).length) {
    return false;
  }
  for (const key of keys) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }
  return true;
}

export function withSavedState(context, func) {
  context.save();
  try {
    func();
  } finally {
    context.restore();
  }
}

export function scheduleCalls(func, timeout = 0) {
  // Schedule calls to func with a timer. If a previously scheduled call
  // has not yet run, cancel it and let the new one override it.
  // Returns a wrapped function that should be called instead of func.
  // This is useful for calls triggered by events that can supersede
  // previous calls; it avoids scheduling many redundant tasks.
  let timeoutID = null;
  return (...args) => {
    if (timeoutID !== null) {
      clearTimeout(timeoutID);
    }
    timeoutID = setTimeout(() => {
      timeoutID = null;
      func(...args);
    }, timeout);
  };
}

export function throttleCalls(func, minTime) {
  // Return a wrapped function. If the function gets called before
  // minTime (in ms) has elapsed since the last call, don't call
  // the function.
  let lastTime = 0;
  let timeoutID = null;
  return (...args) => {
    if (timeoutID !== null) {
      clearTimeout(timeoutID);
      timeoutID = null;
    }
    const now = Date.now();
    if (now - lastTime > minTime) {
      func(...args);
      lastTime = now;
    } else {
      // Ensure that the wrapped function gets called eventually,
      // in the case that no superceding calls come soon enough.
      timeoutID = setTimeout(() => {
        timeoutID = null;
        func(...args);
      }, minTime);
    }
    return timeoutID;
  };
}

export function parseCookies(str) {
  // https://www.geekstrick.com/snippets/how-to-parse-cookies-in-javascript/
  if (!str.trim()) {
    return {};
  }
  return str
    .split(";")
    .map((v) => v.split("="))
    .reduce((acc, v) => {
      acc[decodeURIComponent(v[0].trim())] = decodeURIComponent(v[1].trim());
      return acc;
    }, {});
}

export function capitalizeFirstLetter(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function hyphenatedToCamelCase(s) {
  return s.replace(/-([a-z])/g, (m) => m[1].toUpperCase());
}

export function hasShortcutModifierKey(event) {
  if (navigator.platform.toLowerCase().indexOf("mac") >= 0) {
    return event.metaKey;
  } else {
    return event.ctrlKey;
  }
}

export const arrowKeyDeltas = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function modulo(v, n) {
  // Modulo with Python behavior for negative values of `v`
  // Assumes `n` to be positive
  return v >= 0 ? v % n : ((v % n) + n) % n;
}

export function sign(v) {
  if (v > 0) {
    return 1;
  } else if (v < 0) {
    return -1;
  } else {
    return 0;
  }
}

export function boolInt(v) {
  // Return 1 if `v` is true-y, 0 if `v` is false-y
  return v ? 1 : 0;
}

export function* reversed(seq) {
  // Like Python's reversed(seq) builtin
  for (let i = seq.length - 1; i >= 0; i--) {
    yield seq[i];
  }
}

export function* enumerate(iterable, start = 0) {
  let i = start;
  for (const item of iterable) {
    yield [i, item];
    i++;
  }
}

export function* reversedEnumerate(seq) {
  for (let i = seq.length - 1; i >= 0; i--) {
    yield [i, seq[i]];
  }
}

export function* range(start, stop, step = 1) {
  if (stop === undefined) {
    stop = start;
    start = 0;
  }
  for (let i = start; i < stop; i += step) {
    yield i;
  }
}

export function* chain(...iterables) {
  // After Python's itertools.chain()
  for (const iterable of iterables) {
    for (const item of iterable) {
      yield item;
    }
  }
}

export function parseSelection(selection) {
  const result = {};
  for (const item of selection) {
    const [tp, index] = item.split("/");
    if (result[tp] === undefined) {
      result[tp] = [];
    }
    result[tp].push(parseInt(index));
  }
  for (const indices of Object.values(result)) {
    // Ensure indices are sorted
    indices.sort((a, b) => a - b);
  }
  return result;
}

export function makeUPlusStringFromCodePoint(codePoint) {
  if (codePoint && typeof codePoint != "number") {
    throw new Error(
      `codePoint argument must be a number or falsey; ${typeof codePoint} found`
    );
  }
  return typeof codePoint == "number"
    ? "U+" + codePoint.toString(16).toUpperCase().padStart(4, "0")
    : "";
}

export async function writeToClipboard(clipboardObject) {
  if (!clipboardObject) return;

  const clipboardItemObject = {};
  for (const [key, value] of Object.entries(clipboardObject)) {
    clipboardItemObject[key] = new Blob([value], {
      type: key,
    });
  }

  try {
    await navigator.clipboard.write([new ClipboardItem(clipboardItemObject)]);
  } catch (error) {
    // Write at least the plain/text MIME type to the clipboard
    if (clipboardObject["text/plain"]) {
      await navigator.clipboard.writeText(clipboardObject["text/plain"]);
    }
  }
}

export async function readClipboardTypes() {
  const clipboardContents = await navigator.clipboard.read();
  const clipboardTypes = [];
  for (const item of clipboardContents) {
    clipboardTypes.push(...item.types);
  }
  return clipboardTypes;
}

export async function readFromClipboard(type) {
  const clipboardContents = await navigator.clipboard.read();
  for (const item of clipboardContents) {
    if (item.types.includes(type)) {
      const blob = await item.getType(type);
      return await blob.text();
    }
  }
  return undefined;
}

export function makeAffineTransform(transformation) {
  let t = new Transform();
  t = t.translate(
    transformation.translateX + transformation.tCenterX,
    transformation.translateY + transformation.tCenterY
  );
  t = t.rotate(transformation.rotation * (Math.PI / 180));
  t = t.scale(transformation.scaleX, transformation.scaleY);
  t = t.skew(
    -transformation.skewX * (Math.PI / 180),
    transformation.skewY * (Math.PI / 180)
  );
  t = t.translate(-transformation.tCenterX, -transformation.tCenterY);
  return t;
}

export function htmlToElement(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  if (template.content.childNodes.length !== 1) {
    throw new Error("The html should contain a single node");
  }
  return template.content.firstChild;
}

export function htmlToElements(html) {
  var template = document.createElement("template");
  html = html.trim();
  template.innerHTML = html;
  return template.content.childNodes;
}

export function getCharFromUnicode(codePoint) {
  return codePoint !== undefined ? String.fromCodePoint(codePoint) : "";
}

export async function fetchJSON(url) {
  const response = await fetch(url);
  return await response.json();
}
