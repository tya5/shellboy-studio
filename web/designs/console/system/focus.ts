const TAB_CANDIDATES = 'a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable],audio[controls],video[controls]';

export function tabStops(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TAB_CANDIDATES)].filter(node => {
    if (!(node instanceof HTMLElement) || node.tabIndex < 0 || node.matches(':disabled,input[type="hidden"]')
      || node.closest('[inert],[hidden]') || getComputedStyle(node).visibility === 'hidden') return false;
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).display === 'none') return false;
      const closed: HTMLElement | null = ancestor.parentElement;
      if (closed?.matches('details:not([open])') && ancestor !== closed.querySelector(':scope > summary')) return false;
    }
    return true;
  });
}
