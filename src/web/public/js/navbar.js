document.addEventListener("DOMContentLoaded", () => {
  fetch("/navbar.html")
    .then(res => res.text())
    .then(html => {
      document.querySelector("#navbar").innerHTML = html;
      const navbar = document.querySelector(".navbar");
      const navToggle = document.getElementById("navToggle");
      const navToggleIcon = navToggle.querySelector("i");
      const mobileQuery = window.matchMedia("(max-width: 900px)");
      const isPinned = localStorage.getItem("navbarPinned") === "true";
      if (isPinned && !mobileQuery.matches) {
        navbar.classList.add("pinned");
        navbar.classList.add("locked");
      }
      syncNavbarMode(navbar, mobileQuery);
      updateNavToggleIcon(navbar, navToggleIcon, mobileQuery);
      navToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mobileQuery.matches) {
          navbar.classList.toggle("mobile-open");
        } else {
          const pinned = !navbar.classList.contains("pinned");
          if (pinned) {
            navbar.classList.add("pinned");
            navbar.classList.add("locked");
          } else {
            navbar.classList.remove("pinned");
            navbar.classList.remove("locked");
          }
          localStorage.setItem("navbarPinned", pinned);
        }
        updateNavToggleIcon(navbar, navToggleIcon, mobileQuery);
      });
      mobileQuery.addEventListener("change", () => {
        syncNavbarMode(navbar, mobileQuery);
        updateNavToggleIcon(navbar, navToggleIcon, mobileQuery);
      });
      document.addEventListener("click", (event) => {
        if (!mobileQuery.matches) return;
        if (!navbar.classList.contains("mobile-open")) return;
        if (!navbar.contains(event.target)) {
          navbar.classList.remove("mobile-open");
          updateNavToggleIcon(navbar, navToggleIcon, mobileQuery);
        }
      });
      navbar.querySelectorAll(".navbar-link").forEach(link => {
        link.addEventListener("click", () => {
          if (mobileQuery.matches) {
            navbar.classList.remove("mobile-open");
            updateNavToggleIcon(navbar, navToggleIcon, mobileQuery);
          }
        });
      });
      setActiveNavLink();
      const authScript = document.createElement('script');
      authScript.src = '/js/auth.js';
      document.body.appendChild(authScript);
    })
    .catch(console.error);
});

function hideLinksForNonAdmin() {
  if (!window.currentUser || window.currentUser.role === 'administrator') return;
  const protectedPages = ['admin', 'master_logs', 'scanners', 'app_settings'];
  protectedPages.forEach(page => {
    const link = document.querySelector(`.navbar-link[data-page="${page}"]`);
    if (link && link.parentElement) {
      link.parentElement.style.display = 'none';
    }
  });
}

function setActiveNavLink() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.navbar-link');
  navLinks.forEach(link => {
    link.classList.remove('active');
    const linkPath = link.getAttribute('href');
    const cleanCurrentPath = currentPath.replace(/\/$/, '');
    const cleanLinkPath = linkPath.replace(/\/$/, '');
    if (cleanCurrentPath === cleanLinkPath) {
      link.classList.add("active");
    }

  });
}

function syncNavbarMode(navbar, mobileQuery) {
  if (mobileQuery.matches) {
    navbar.classList.remove("pinned");
    navbar.classList.remove("locked");
  } else {
    navbar.classList.remove("mobile-open");
    if (localStorage.getItem("navbarPinned") === "true") {
      navbar.classList.add("pinned");
      navbar.classList.add("locked");
    }
  }
}

function updateNavToggleIcon(navbar, icon, mobileQuery) {
  if (!icon) return;
  if (mobileQuery.matches) {
    icon.className = navbar.classList.contains("mobile-open") ? "fas fa-xmark" : "fas fa-bars";
  } else {
    icon.className = "fas fa-thumbtack";
  }
}
