const menuButton = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
const directoryButton = document.querySelector('.directory-toggle');
const directoryLinks = document.querySelector('.directory-links');

if (menuButton && siteNav) {
  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? '打开导航菜单' : '关闭导航菜单');
    siteNav.classList.toggle('is-open', !isOpen);
  });

  siteNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', '打开导航菜单');
      siteNav.classList.remove('is-open');
    }
  });
}

if (directoryButton && directoryLinks) {
  const setDirectoryOpen = (open) => {
    directoryButton.setAttribute('aria-expanded', String(open));
    directoryButton.querySelector('.directory-toggle-label').textContent = open ? '收起目录' : '展开目录';
    directoryLinks.classList.toggle('is-open', open);
  };

  directoryButton.addEventListener('click', () => {
    setDirectoryOpen(directoryButton.getAttribute('aria-expanded') !== 'true');
  });

  directoryLinks.addEventListener('click', (event) => {
    if (event.target.closest('a')) setDirectoryOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setDirectoryOpen(false);
  });
}
