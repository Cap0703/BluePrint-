/**
 * public/js/auth.js
 * Handles authentication state, token checks, navbar updates, and logout flow.
 * @ai-generated
 */
let currentUser = null;

/**
 * Loads the current authenticated user from the server and redirects to login if the token is missing or invalid.
 * @ai-generated
 * @returns {Promise<void>}
 */
/**
 * Loads the current authenticated user from the server and redirects to login if the token is missing or invalid.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function loadUserInfo() {
  try {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      return;
    }
    currentUser = await response.json();
    // make user available globally for other scripts
    window.currentUser = currentUser;
    updateNavbarWithUser();
  } catch (err) {
    console.error('Error loading user info:', err);
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  }
}

/**
 * Adds the authenticated user's profile block to the navigation bar.
 * @ai-generated
 * @returns {void}
 */
function updateNavbarWithUser() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  const userSection = document.createElement('div');
  userSection.className = 'navbar-user-section';
  userSection.style.cssText = `
    padding: 15px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    margin-top: 10px;
    text-align: center;
  `;
  userSection.innerHTML = `
    <div style="color: #b0b7c3; font-size: 0.85rem; margin-bottom: 10px;">
      <p style="margin: 2px 0; font-weight: 600; color: white;">${currentUser.first_name} ${currentUser.last_name}</p>
      <p style="margin: 2px 0; color: #3498db; text-transform: capitalize;">${currentUser.role}</p>
    </div>
    <button id="logoutBtn" style="
      width: 100%;
      padding: 8px 12px;
      background-color: rgba(255, 255, 255, 0.1);
      color: #b0b7c3;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.3s ease;
    ">
      <i class="fas fa-sign-out-alt" style="margin-right: 5px;"></i> Logout
    </button>
  `;
  navbar.appendChild(userSection);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  filterNavByRole();
}

/**
 * Updates the navbar display based on the current user's role, hiding unauthorized links.
 * @ai-generated
 * @returns {void}
 */
function filterNavByRole() {
  if (!currentUser) return;
  if (currentUser.role === 'administrator') {
    const myLogsLink = document.querySelector(`.navbar-link[data-page="my_logs"]`);
    if (myLogsLink && myLogsLink.parentElement) {
      myLogsLink.parentElement.style.display = 'none';
    }
    return;
  }
  window.currentUser = currentUser;
  /**
   * Hides links that are restricted for non-admin users.
   * @ai-generated
   * @returns {void}
   */
  const hideLinks = () => {
    const protectedPages = ['admin', 'master_logs', 'scanners', 'app_settings'];
    let foundOne = false;
    protectedPages.forEach(page => {
      const link = document.querySelector(`.navbar-link[data-page="${page}"]`);
      if (link && link.parentElement) {
        link.parentElement.style.display = 'none';
        foundOne = true;
      }
    });
    if (!foundOne) {
      setTimeout(hideLinks, 100);
    }
  };
  if (typeof hideLinksForNonAdmin === 'function') {
    hideLinksForNonAdmin();
  }
  hideLinks();

  const myLogsLink = document.querySelector(`.navbar-link[data-page="my_logs"]`);
  if (myLogsLink && myLogsLink.parentElement) {
    myLogsLink.parentElement.style.display = '';
  }
}

/**
 * Sends a logout request to the server and clears client auth state.
 * @ai-generated
 * @returns {Promise<void>}
 */
async function logout() {
  try {
    const token = localStorage.getItem('auth_token');
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadUserInfo);
} else {
  loadUserInfo();
}
