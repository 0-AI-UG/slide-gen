/** Parse a CSS linear-gradient or radial-gradient inner string into structured data. */
export function parseGradient(type: "linear" | "radial", inner: string): any | null {
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
    }

    for (let i = colorTokenStart; i < tokens.length; i++) {
      const token = tokens[i].trim();
      const colorMatch = token.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\s*([\d.]+%)?$/);
      if (colorMatch) {
        const color = colorMatch[1];
        const pos = colorMatch[2]
          ? parseFloat(colorMatch[2])
          : i === colorTokenStart ? 0 : i === tokens.length - 1 ? 100 : ((i - colorTokenStart) / (tokens.length - 1 - colorTokenStart)) * 100;
        stops.push({ color, position: pos });
      } else {
        const bareColor = token.match(/^(\S+)\s+([\d.]+%)?$/);
        if (bareColor) {
          const temp = document.createElement("div");
          temp.style.color = bareColor[1];
          document.body.appendChild(temp);
          const resolved = getComputedStyle(temp).color;
          document.body.removeChild(temp);
          const pos = bareColor[2]
            ? parseFloat(bareColor[2])
            : i === colorTokenStart ? 0 : i === tokens.length - 1 ? 100 : ((i - colorTokenStart) / (tokens.length - 1 - colorTokenStart)) * 100;
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
      // Preserve radial shape info (circle vs ellipse)
      if (firstToken.includes("circle")) {
        result.radialShape = "circle";
      } else if (firstToken.includes("ellipse")) {
        result.radialShape = "ellipse";
      }
    }
    return result;
  } catch (e) {
    console.warn("[gradient] Parse error:", e);
    return null;
  }
}
