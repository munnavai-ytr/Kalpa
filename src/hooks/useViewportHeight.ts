'use client';

import { useEffect, useState } from 'react';

export interface ViewportMetrics {
  height: number;
  offsetTop: number;
  keyboardOpen: boolean;
}

export function useViewportHeight(): ViewportMetrics {
  const [metrics, setMetrics] = useState<ViewportMetrics>({
    height: 0,
    offsetTop: 0,
    keyboardOpen: false,
  });

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const fullH = window.innerHeight;
      const visH = vv ? vv.height : fullH;
      const offsetTop = vv ? vv.offsetTop : 0;
      const keyboardOpen = fullH - visH > 120;
      document.documentElement.style.setProperty('--vvh', `${Math.round(visH)}px`);
      setMetrics({
        height: Math.round(visH),
        offsetTop: Math.round(offsetTop),
        keyboardOpen,
      });
    };

    update();
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
    };
  }, []);

  return metrics;
}
