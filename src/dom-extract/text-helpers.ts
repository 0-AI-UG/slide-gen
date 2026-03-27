export interface RawTextRun {
  text: string;
  textNode: Node;
  el: Element;
  blockAncestor: Element;
  rangeRect: DOMRect;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  color: string;
  letterSpacing: number;
  textTransform: string;
  textAlign: string;
  rotation: number;
}

/** Walk up from `el` to `slideEl` looking for the nearest block-level ancestor. */
export function findBlockAncestor(el: Element, slideEl: Element): Element {
  let cur: Element | null = el;
  while (cur && cur !== slideEl) {
    const d = getComputedStyle(cur).display;
    if (d === "block" || d === "flex" || d === "grid" || d === "list-item" ||
        d === "table" || d === "table-cell" ||
        getComputedStyle(cur).position === "absolute" ||
        getComputedStyle(cur).position === "fixed") {
      return cur;
    }
    cur = cur.parentElement;
  }
  return slideEl;
}

/** Check whether a <br> element exists between two nodes inside a container. */
export function hasBrBetween(nodeA: Node, nodeB: Node, container: Element): boolean {
  const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_ALL);
  let foundA = false;
  let current: Node | null = treeWalker.firstChild();
  while (current) {
    if (current === nodeA) { foundA = true; }
    else if (foundA && current === nodeB) { return false; }
    else if (foundA && current instanceof HTMLBRElement) { return true; }
    current = treeWalker.nextNode();
  }
  return false;
}
