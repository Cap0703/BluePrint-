let currentUser = null;

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
    updateNavbarWithUser();
  } catch (err) {
    console.error('Error loading user info:', err);
    localStorage.removeItem('auth_token');
    window.location.href = '/login';
  }
}

function updateNavbarWithUser() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;
  const userSection = document.createElement('div');
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
}

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

document.addEventListener('DOMContentLoaded', loadUserInfo);
