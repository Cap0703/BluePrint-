document.addEventListener("DOMContentLoaded", () => {
  fetch("/navbar.html")
    .then(res => res.text())
    .then(html => {
      document.querySelector("#navbar").innerHTML = html;

      const navbar = document.querySelector(".navbar");
      const navToggle = document.getElementById("navToggle");

      const isPinned = localStorage.getItem("navbarPinned") === "true";
      
      if (isPinned) {
        navbar.classList.add("pinned");
        navbar.classList.add("locked");
      }

      navToggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const pinned = !navbar.classList.contains("pinned");
        
        if (pinned) {
          navbar.classList.add("pinned");
          navbar.classList.add("locked");
        } else {
          navbar.classList.remove("pinned");
          navbar.classList.remove("locked");
        }

        localStorage.setItem("navbarPinned", pinned);
      });

      setActiveNavLink();
    })
    .catch(console.error);
});

function setActiveNavLink() {
  const currentPath = window.location.pathname;
  
  const navLinks = document.querySelectorAll('.navbar-link');
  
  navLinks.forEach(link => {
    link.classList.remove('active');
    const linkPath = link.getAttribute('href');
    
    // Remove trailing slash for comparison
    const cleanCurrentPath = currentPath.replace(/\/$/, '');
    const cleanLinkPath = linkPath.replace(/\/$/, '');
    
    if (cleanCurrentPath === cleanLinkPath) {
      link.classList.add("active");
    }

  });
}