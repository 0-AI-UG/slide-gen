/** Split a CSS backgroundImage value on top-level commas (not inside parentheses). */
export function splitBackgroundLayers(bgImage: string): string[] {
  const layers: string[] = [];
  let depth = 0, current = "";
  for (const ch of bgImage) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) layers.push(current.trim());
  return layers;
}

/** Parse a single gradient layer string (e.g. "linear-gradient(...)") */
export function parseSingleGradientLayer(layer: string): any | null {
  const patterns: { regex: RegExp; type: "linear" | "radial" | "conic"; repeating: boolean }[] = [
    { regex: /repeating-linear-gradient\((.+)\)/, type: "linear", repeating: true },
    { regex: /repeating-radial-gradient\((.+)\)/, type: "radial", repeating: true },
    { regex: /repeating-conic-gradient\((.+)\)/, type: "conic", repeating: true },
    { regex: /conic-gradient\((.+)\)/, type: "conic", repeating: false },
    { regex: /linear-gradient\((.+)\)/, type: "linear", repeating: false },
    { regex: /radial-gradient\((.+)\)/, type: "radial", repeating: false },
  ];

  for (const { regex, type, repeating } of patterns) {
    const match = layer.match(regex);
    if (match) {
      const result = parseGradient(type, match[1]);
      if (result && repeating) result.repeating = true;
      return result;
    }
  }
  return null;
}

/** Detect and parse any gradient from a CSS backgroundImage value (returns first gradient found). */
export function detectGradient(bgImage: string): any | null {
  if (!bgImage || bgImage === "none") return null;
  const layers = splitBackgroundLayers(bgImage);
  for (const layer of layers) {
    const result = parseSingleGradientLayer(layer);
    if (result) return result;
  }
  return null;
}

/** Detect and parse all gradient layers from a CSS backgroundImage value. */
export function detectGradients(bgImage: string): any[] {
  if (!bgImage || bgImage === "none") return [];
  const layers = splitBackgroundLayers(bgImage);
  const results: any[] = [];
  for (const layer of layers) {
    const result = parseSingleGradientLayer(layer);
    if (result) results.push(result);
  }
  return results;
}

/** Parse a CSS linear-gradient, radial-gradient, or conic-gradient inner string into structured data. */
export function parseGradient(type: "linear" | "radial" | "conic", inner: string): any | null {
  try {
    const stops: { color: string; position: number }[] = [];
    let angle = 180;

    const tokens: string[] = [];
    let depth = 0, current = "";
    for (const ch of inner) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        tokens.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) tokens.push(current.trim());

    let colorTokenStart = 0;

    let conicAngle = 0;
    let conicPosition: { x: number; y: number } | undefined;

    if (type === "linear") {
      const first = tokens[0];
      if (first) {
        const degMatch = first.match(/^([\d.]+)deg$/);
        if (degMatch) {
          angle = parseFloat(degMatch[1]);
          colorTokenStart = 1;
        } else if (first.startsWith("to ")) {
          const dir = first.replace("to ", "").trim();
          const dirMap: Record<string, number> = {
            top: 0, right: 90, bottom: 180, left: 270,
            "top right": 45, "right top": 45,
            "bottom right": 135, "right bottom": 135,
            "bottom left": 225, "left bottom": 225,
            "top left": 315, "left top": 315,
          };
          if (dir in dirMap) {
            angle = dirMap[dir];
            colorTokenStart = 1;
          }
        }
      }
    } else if (type === "conic") {
      // Parse: "from <angle> at <x>% <y>%" or just "from <angle>" or just "at <x>% <y>%"
      const first = tokens[0];
      if (first) {
        const fromMatch = first.match(/from\s+([\d.]+)deg/);
        if (fromMatch) conicAngle = parseFloat(fromMatch[1]);
        const atMatch = first.match(/at\s+([\d.]+)%\s+([\d.]+)%/);
        if (atMatch) conicPosition = { x: parseFloat(atMatch[1]), y: parseFloat(atMatch[2]) };
        // If the first token has "from" or "at", it's not a color stop
        if (fromMatch || atMatch) colorTokenStart = 1;
      }
    }

    for (let i = colorTokenStart; i < tokens.length; i++) {
      const token = tokens[i].trim();
      // Match color + optional position (percentage or px)
      const colorMatch = token.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*([\d.]+(%|px))?$/);
      if (colorMatch) {
        const color = colorMatch[1];
        let pos: number;
        if (colorMatch[2]) {
          if (colorMatch[3] === "px") {
            // px positions: store raw value as negative to flag for later conversion
            pos = parseFloat(colorMatch[2]);
            // Mark as px by storing in a special range (will be normalized later)
          } else {
            pos = parseFloat(colorMatch[2]);
          }
        } else {
          pos = i === colorTokenStart ? 0 : i === tokens.length - 1 ? 100 : ((i - colorTokenStart) / (tokens.length - 1 - colorTokenStart)) * 100;
        }
        stops.push({ color, position: pos });
      } else {
        const bareColor = token.match(/^(\S+)\s+([\d.]+(%|px))?$/);
        if (bareColor) {
          const temp = document.createElement("div");
          temp.style.color = bareColor[1];
          document.body.appendChild(temp);
          const resolved = getComputedStyle(temp).color;
          document.body.removeChild(temp);
          let pos: number;
          if (bareColor[2]) {
            pos = parseFloat(bareColor[2]);
          } else {
            pos = i === colorTokenStart ? 0 : i === tokens.length - 1 ? 100 : ((i - colorTokenStart) / (tokens.length - 1 - colorTokenStart)) * 100;
          }
          stops.push({ color: resolved, position: pos });
        } else if (!token.includes("circle") && !token.includes("ellipse") && !token.includes("closest") && !token.includes("farthest")) {
          const temp = document.createElement("div");
          temp.style.color = token;
          document.body.appendChild(temp);
          const resolved = getComputedStyle(temp).color;
          document.body.removeChild(temp);
          if (resolved && resolved !== "") {
            const pos = i === colorTokenStart ? 0 : i === tokens.length - 1 ? 100 : ((i - colorTokenStart) / (tokens.length - 1 - colorTokenStart)) * 100;
            stops.push({ color: resolved, position: pos });
          }
        }
      }
    }

    if (stops.length < 2) return null;
    const result: any = { type, stops };
    if (type === "linear") result.angle = angle;
    if (type === "radial" && tokens.length > 0) {
      const firstToken = tokens[0];
      const posMatch = firstToken.match(/at\s+([\d.]+)%\s+([\d.]+)%/);
      if (posMatch) {
        result.radialPosition = { x: parseFloat(posMatch[1]), y: parseFloat(posMatch[2]) };
      }
      if (firstToken.includes("circle")) {
        result.radialShape = "circle";
      } else if (firstToken.includes("ellipse")) {
        result.radialShape = "ellipse";
      }
      // Parse radial extent keyword
      if (firstToken.includes("closest-side")) {
        result.radialExtent = "closest-side";
      } else if (firstToken.includes("closest-corner")) {
        result.radialExtent = "closest-corner";
      } else if (firstToken.includes("farthest-side")) {
        result.radialExtent = "farthest-side";
      } else if (firstToken.includes("farthest-corner")) {
        result.radialExtent = "farthest-corner";
      }
    }
    if (type === "conic") {
      if (conicAngle !== undefined) result.conicAngle = conicAngle;
      if (conicPosition) result.radialPosition = conicPosition;
    }
    return result;
  } catch (e) {
    console.warn("[gradient] Parse error:", e);
    return null;
  }
}
