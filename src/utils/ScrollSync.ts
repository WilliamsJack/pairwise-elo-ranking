function clampScrollTop(el: HTMLElement, top: number): number {
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
  return Math.max(0, Math.min(maxTop, top));
}

export function installScrollSync(leftEl: HTMLElement, rightEl: HTMLElement): () => void {
  const win = leftEl.ownerDocument.defaultView ?? window;

  let leftLast = leftEl.scrollTop;
  let rightLast = rightEl.scrollTop;

  let suppressLeft = false;
  let suppressRight = false;

  let releaseLeftRaf: number | null = null;
  let releaseRightRaf: number | null = null;

  const suppressSide = (side: 'left' | 'right') => {
    if (side === 'left') {
      suppressLeft = true;
      if (releaseLeftRaf != null) win.cancelAnimationFrame(releaseLeftRaf);
      releaseLeftRaf = win.requestAnimationFrame(() => {
        suppressLeft = false;
        releaseLeftRaf = null;
      });
    } else {
      suppressRight = true;
      if (releaseRightRaf != null) win.cancelAnimationFrame(releaseRightRaf);
      releaseRightRaf = win.requestAnimationFrame(() => {
        suppressRight = false;
        releaseRightRaf = null;
      });
    }
  };

  const onLeftScroll = () => {
    const cur = leftEl.scrollTop;
    if (suppressLeft) {
      leftLast = cur;
      return;
    }

    const delta = cur - leftLast;
    leftLast = cur;
    if (delta === 0) return;

    suppressSide('right');
    rightEl.scrollTop = clampScrollTop(rightEl, rightEl.scrollTop + delta);
    rightLast = rightEl.scrollTop;
  };

  const onRightScroll = () => {
    const cur = rightEl.scrollTop;
    if (suppressRight) {
      rightLast = cur;
      return;
    }

    const delta = cur - rightLast;
    rightLast = cur;
    if (delta === 0) return;

    suppressSide('left');
    leftEl.scrollTop = clampScrollTop(leftEl, leftEl.scrollTop + delta);
    leftLast = leftEl.scrollTop;
  };

  leftEl.addEventListener('scroll', onLeftScroll, { passive: true });
  rightEl.addEventListener('scroll', onRightScroll, { passive: true });

  return () => {
    leftEl.removeEventListener('scroll', onLeftScroll);
    rightEl.removeEventListener('scroll', onRightScroll);

    if (releaseLeftRaf != null) win.cancelAnimationFrame(releaseLeftRaf);
    if (releaseRightRaf != null) win.cancelAnimationFrame(releaseRightRaf);

    releaseLeftRaf = null;
    releaseRightRaf = null;
  };
}
