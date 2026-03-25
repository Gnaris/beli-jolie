import { useRef, useCallback } from "react";

/**
 * Prevents accidental modal close when selecting text inside a modal
 * and releasing the mouse on the backdrop.
 * Only closes if BOTH mousedown AND mouseup happen on the backdrop itself.
 */
export function useBackdropClose(onClose: () => void) {
  const mouseDownOnBackdrop = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnBackdrop.current) {
      onClose();
    }
    mouseDownOnBackdrop.current = false;
  }, [onClose]);

  return { onMouseDown: handleMouseDown, onMouseUp: handleMouseUp };
}
