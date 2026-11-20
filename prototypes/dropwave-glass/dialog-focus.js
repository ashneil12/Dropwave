export function focusTrapTarget(focusableElements, activeElement, shiftKey) {
  if (!focusableElements.length) return null;
  const first = focusableElements[0];
  const last = focusableElements.at(-1);
  const activeIndex = focusableElements.indexOf(activeElement);
  if (shiftKey && (activeElement === first || activeIndex === -1)) return last;
  if (!shiftKey && (activeElement === last || activeIndex === -1)) return first;
  return null;
}
