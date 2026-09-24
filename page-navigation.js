"use strict";

(() => {
  const navigation = document.querySelector('.page-navigation');
  const toggle = document.querySelector('#page-nav-toggle');
  const panel = document.querySelector('#page-nav-panel');
  const links = [...panel.querySelectorAll('a[href^="#"]')];
  const targets = links.map(link => document.getElementById(link.hash.slice(1)));
  const setOpen = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '收起页面目录' : '打开页面目录');
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  panel.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    setOpen(false);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !navigation.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus({ preventScroll: true });
    }
  });
  document.addEventListener('focusin', event => {
    // focusout can briefly expose BODY before a native mouse/Tab focus transfer finishes.
    if (!navigation.contains(event.target)) setOpen(false);
  });
  let frame = 0;
  const update = () => {
    frame = 0;
    let active = 0;
    targets.forEach((target, index) => {
      if (target && target.getBoundingClientRect().top <= Math.min(160, innerHeight / 4)) active = index;
    });
    if (scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
      active = targets.length - 1;
    }
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  const scheduleUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  toggle.addEventListener('click', update);
  update();
})();
