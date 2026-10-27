export function buildNextLiteShimFiles(): Record<string, string> {
  const navigationShim = `import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export const KalpaRouteContext = createContext({
  pathname: '/',
  search: '',
  params: {},
  navigate: (href, replace) => {
    const clean = href.startsWith('#') ? href.slice(1) : href;
    if (replace) window.location.replace('#' + clean);
    else window.location.hash = clean;
  },
});

export function parseHashUrl() {
  if (typeof window === 'undefined') return { pathname: '/', search: '' };
  const raw = window.location.hash ? window.location.hash.slice(1) : '/';
  const qIdx = raw.indexOf('?');
  if (qIdx >= 0) {
    return { pathname: raw.slice(0, qIdx) || '/', search: raw.slice(qIdx + 1) };
  }
  return { pathname: raw || '/', search: '' };
}

export function usePathname() {
  return useContext(KalpaRouteContext).pathname;
}

export function useParams() {
  return useContext(KalpaRouteContext).params;
}

export function useSearchParams() {
  const { search } = useContext(KalpaRouteContext);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useRouter() {
  const { navigate } = useContext(KalpaRouteContext);
  return useMemo(() => ({
    push: (href) => navigate(href, false),
    replace: (href) => navigate(href, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
    prefetch: async () => {},
  }), [navigate]);
}

export function redirect(href) {
  if (typeof window !== 'undefined') {
    window.location.hash = href.startsWith('/') ? href : '/' + href;
  }
  throw new Error('KALPA_NEXT_REDIRECT:' + href);
}

export function notFound() {
  throw new Error('KALPA_NEXT_NOT_FOUND');
}
`;

  const linkShim = `import React from 'react';
import { useRouter } from './navigation';

export default function Link({ href, replace, onClick, children, ...rest }) {
  const router = useRouter();
  const url = typeof href === 'string' ? href : (href?.pathname || '/');
  const isExternal = /^(https?:|mailto:|tel:)/i.test(url);

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented || isExternal) return;
    e.preventDefault();
    if (replace) router.replace(url);
    else router.push(url);
  };

  return React.createElement(
    'a',
    { ...rest, href: isExternal ? url : '#' + url, onClick: handleClick },
    children
  );
}
`;

  const imageShim = `import React from 'react';

export default function Image({ src, alt = '', width, height, fill, priority, unoptimized, quality, placeholder, blurDataURL, style, ...rest }) {
  const resolvedSrc = typeof src === 'string' ? src : (src && src.src ? src.src : '');
  const fillStyle = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }
    : style;
  return React.createElement('img', {
    src: resolvedSrc,
    alt,
    width: fill ? undefined : width,
    height: fill ? undefined : height,
    referrerPolicy: 'no-referrer',
    style: fillStyle,
    ...rest,
  });
}
`;

  const headShim = `import React, { useEffect } from 'react';

export default function Head({ children }) {
  useEffect(() => {
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === 'title' && child.props.children) {
        document.title = String(child.props.children);
      }
    });
  }, [children]);
  return null;
}
`;

  const scriptShim = `import { useEffect } from 'react';

export default function Script({ src, dangerouslySetInnerHTML, children }) {
  useEffect(() => {
    const s = document.createElement('script');
    if (src) s.src = src;
    else if (dangerouslySetInnerHTML?.__html) s.text = dangerouslySetInnerHTML.__html;
    else if (typeof children === 'string') s.text = children;
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [src]);
  return null;
}
`;

  const fontShim = `function makeFont() {
  return { className: '', style: {}, variable: '' };
}
const fontProxy = new Proxy(
  { __esModule: true, default: makeFont },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      return makeFont;
    },
  }
);
module.exports = fontProxy;
`;

  const dynamicShim = `import React, { Suspense, lazy } from 'react';

export default function dynamic(loader, opts) {
  const LazyComp = lazy(async () => {
    const mod = await loader();
    return 'default' in mod ? mod : { default: mod };
  });
  const Loading = opts && opts.loading ? opts.loading : null;
  return function DynamicWrapper(props) {
    return React.createElement(
      Suspense,
      { fallback: Loading ? React.createElement(Loading) : null },
      React.createElement(LazyComp, props)
    );
  };
}
`;

  return {
    '/__kalpa/shims/navigation.js': navigationShim,
    '/__kalpa/shims/link.js': linkShim,
    '/__kalpa/shims/image.js': imageShim,
    '/__kalpa/shims/head.js': headShim,
    '/__kalpa/shims/script.js': scriptShim,
    '/__kalpa/shims/font-google.js': fontShim,
    '/__kalpa/shims/font-local.js': fontShim,
    '/__kalpa/shims/dynamic.js': dynamicShim,
  };
}
