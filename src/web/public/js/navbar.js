document.addEventListener("DOMContentLoaded", () => {
  fetch("/partials/navbar.html")
    .then(res => {
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      return res.text();
    })
    .then(html => {
      document.querySelector("#navbar").innerHTML = html;
      setActiveNavLink();
    })
    .catch(err => {
      console.error("Navbar load failed:", err);
      document.querySelector("#navbar").innerHTML = `
        <nav class="navbar">
          <div class="nav-container">
            <a href="/" class="nav-link">Home</a>
            <a href="/calendar" class="nav-link">Calendar</a>
          </div>
        </nav>
      `;
    });
});

function setActiveNavLink() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.navbar-link');
  navLinks.forEach(link => {
    link.classList.remove('active');
    const linkPath = link.getAttribute('href');
    if (currentPath === linkPath || 
        (currentPath.startsWith(linkPath) && linkPath !== '/') ||
        (currentPath === '/' && linkPath === '/')) {
      link.classList.add('active');
    }
  });
}