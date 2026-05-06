const MOBILE_MENU_QUERY = '(max-width: 1024px)';

export function setupPortalMenu(options = {}) {
  const {
    headerSelector = '.portal-header',
    toggleSelector = '#menuToggle',
    navSelector = '#sidebar',
    navOpenClass = 'is-open',
    bodyOpenClass = 'has-open-menu'
  } = options;

  const header = document.querySelector(headerSelector);
  const toggle = document.querySelector(toggleSelector);
  const nav = document.querySelector(navSelector);

  if (!header || !toggle || !nav) {
    return null;
  }

  const mediaQuery = window.matchMedia(MOBILE_MENU_QUERY);
  let scrim = document.querySelector('.portal-menu-scrim');

  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'portal-menu-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scrim);
  }

  const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const isMobile = () => mediaQuery.matches;
  const isOpen = () => nav.classList.contains(navOpenClass);

  function setHeaderHeight() {
    const headerHeight = Math.ceil(header.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--portal-header-height', `${headerHeight}px`);
  }

  function updateA11yState(expanded) {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Close navigation menu' : 'Open navigation menu');
    nav.setAttribute('aria-hidden', String(isMobile() ? !expanded : false));
  }

  function openMenu() {
    if (!isMobile()) {
      updateA11yState(false);
      return;
    }

    nav.classList.add(navOpenClass);
    document.body.classList.add(bodyOpenClass);
    updateA11yState(true);

    requestAnimationFrame(() => {
      const firstFocusable = nav.querySelector(focusableSelector);
      if (firstFocusable instanceof HTMLElement) {
        firstFocusable.focus();
      }
    });
  }

  function closeMenu({ returnFocus = false } = {}) {
    nav.classList.remove(navOpenClass);
    document.body.classList.remove(bodyOpenClass);
    updateA11yState(false);

    if (returnFocus && isMobile()) {
      toggle.focus();
    }
  }

  function toggleMenu() {
    if (isOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function handleViewportChange() {
    setHeaderHeight();

    if (!isMobile()) {
      closeMenu();
      nav.setAttribute('aria-hidden', 'false');
    } else {
      updateA11yState(isOpen());
    }
  }

  toggle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

  nav.addEventListener('click', event => {
    if (!isMobile()) return;

    const interactiveTarget = event.target.closest('a, button');
    if (interactiveTarget) {
      closeMenu();
    }
  });

  scrim.addEventListener('click', () => closeMenu());

  document.addEventListener('click', event => {
    if (!isMobile() || !isOpen()) return;

    const clickedInsideToggle = toggle.contains(event.target);
    const clickedInsideNav = nav.contains(event.target);

    if (!clickedInsideToggle && !clickedInsideNav) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) {
      closeMenu({ returnFocus: true });
    }
  });

  window.addEventListener('resize', setHeaderHeight, { passive: true });

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleViewportChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleViewportChange);
  }

  setHeaderHeight();
  updateA11yState(false);
  handleViewportChange();

  return {
    openMenu,
    closeMenu,
    toggleMenu
  };
}
