import { auth, db } from './firebase.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

async function getUserProfile(uid) {
  if (!uid) return null;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) return null;
    return { uid: userSnap.id, ...userSnap.data() };
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
}

async function createUserProfile(uid, email, role, name = '') {
  if (!uid || !email || !role) return;
  try {
    await setDoc(doc(db, 'users', uid), {
      name: name || email.split('@')[0] || 'User',
      email,
      role,
      status: 'Active',
      createdAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error('Failed to create user profile:', error);
  }
}

function isFirebaseConfigValid() {
  const apiKey = auth?.app?.options?.apiKey;
  return typeof apiKey === 'string' && apiKey.length > 20 && !apiKey.includes('NEW_API_KEY') && !apiKey.includes('YOUR_API_KEY');
}

async function ensureDefaultAdmin() {
  if (!isFirebaseConfigValid()) {
    console.warn('Skipping default admin setup: Firebase config is not fully configured.');
    return;
  }

  const email = 'admin@nursing.edu';
  const password = 'admin123';

  try {
    // Try to sign in as admin (they may already exist)
    try {
      const signInResponse = await signInWithEmailAndPassword(auth, email, password);
      let profile = await getUserProfile(signInResponse.user.uid);
      if (!profile || profile.role !== 'admin') {
        try {
          await createUserProfile(signInResponse.user.uid, email, 'admin', 'System Administrator');
        } catch (profileError) {
          console.warn('Could not create admin Firestore profile:', profileError);
          // Continue anyway - at least auth account exists
        }
      }
      await signOut(auth);

      return;
    } catch (signInError) {
      if (signInError.code !== 'auth/user-not-found') {
        // Some other error, log and continue
        console.warn('Admin sign-in check failed:', signInError.code);
        throw signInError;
      }
      // User not found - proceed to create
    }

    // Admin account doesn't exist - create it
    console.log('Creating default admin account...');
    const newAdmin = await createUserWithEmailAndPassword(auth, email, password);
    console.log('✅ Admin account created in Firebase Auth');
    
    try {
      await createUserProfile(newAdmin.user.uid, email, 'admin', 'System Administrator');
      console.log('✅ Admin profile created in Firestore');
    } catch (profileError) {
      console.warn('⚠️ Admin created in Auth but Firestore profile failed:', profileError);
      // Admin auth account exists - this is enough to login
    }
    
    await signOut(auth);
  } catch (error) {
    if (error.code === 'auth/api-key-not-valid' || error.code === 'auth/invalid-api-key') {
      console.warn('Firebase auth API key is invalid; default admin setup skipped.');
      return;
    }
    
    if (error.code === 'auth/email-already-in-use') {
      console.log('Admin account already exists in Firebase Auth');
      await signOut(auth);
      return;
    }

    console.error('Unexpected error in admin setup:', error);
  }
}

// Password visibility toggle
function setupPasswordToggle() {
  const passwordInput = document.getElementById('loginPassword');
  const passwordToggle = document.getElementById('passwordToggle');
  const eyeIcon = passwordToggle.querySelector('.eye-icon');
  const eyeOffIcon = passwordToggle.querySelector('.eye-off-icon');

  if (passwordToggle) {
    passwordToggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      eyeIcon.style.display = isPassword ? 'none' : 'block';
      eyeOffIcon.style.display = isPassword ? 'block' : 'none';
    });
  }
}

function redirectToRolePage(role) {
  if (role === 'student') return window.location.href = 'index.html';
  if (role === 'instructor') return window.location.href = 'instructor.html';
  if (role === 'admin') return window.location.href = 'admin.html';
  return window.location.href = 'login.html';
}

function showErrorMessage(message, formId) {
  const form = document.getElementById(formId);
  let errorDiv = form.querySelector('.error-message');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    form.insertBefore(errorDiv, form.firstChild);
  }
  errorDiv.textContent = '❌ ' + message;
  errorDiv.style.display = 'block';
}

function showSuccessMessage(message, formId) {
  const form = document.getElementById(formId);
  let successDiv = form.querySelector('.success-message');
  if (!successDiv) {
    successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    form.insertBefore(successDiv, form.firstChild);
  }
  successDiv.textContent = '✅ ' + message;
  successDiv.style.display = 'block';
}

function clearErrorMessage() {
  const errorDivs = document.querySelectorAll('.error-message, .success-message');
  errorDivs.forEach(div => div.style.display = 'none');
}

let loginInProgress = false;

async function handleLogin(event) {
  event.preventDefault();
  clearErrorMessage();
  loginInProgress = true;

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const role = document.getElementById('loginRole').value;

  if (!email || !password || !role) {
    showErrorMessage('Please fill in all fields', 'loginForm');
    loginInProgress = false;
    return;
  }

  try {
    // Ensure fresh sign-in session to enforce selected role validation
    if (auth.currentUser) {
      await signOut(auth);
      localStorage.removeItem('currentUser');
    }

 const credential = await signInWithEmailAndPassword(auth, email, password);

// Force-refresh ID token to pick up custom claims
await credential.user.getIdToken(true);

let profile = await getUserProfile(credential.user.uid);
    
    // Only create profile for admin account if it doesn't exist
    if (email === 'admin@nursing.edu') {
      if (!profile) {
        await createUserProfile(credential.user.uid, email, 'admin', 'System Administrator');
        profile = await getUserProfile(credential.user.uid);
      }
    }

    if (!profile) {
      showErrorMessage('Account not found. Please contact your administrator to create your account.', 'loginForm');
      return;
    }

    // Strict role validation - selected role must match account role
    if (profile.role !== role) {
      // Ensure no stale auth/session state remains
      await signOut(auth);
      localStorage.removeItem('currentUser');

      const roleMapping = {
        'student': 'Clinical Student',
        'instructor': 'Clinical Instructor',
        'admin': 'Administrator'
      };
      const actualRole = roleMapping[profile.role] || profile.role;
      const selectedRole = roleMapping[role] || role;
      showErrorMessage(`Selected role does not match your account type.`);
      await signOut(auth);
      localStorage.removeItem('currentUser');
      loginInProgress = false;
      return;
    }

    const userData = {
      uid: profile.uid,
      name: profile.name || profile.email,
      email: profile.email,
      role: profile.role,
      studentId: profile.studentId || null,
      status: profile.status || null
    };
    localStorage.setItem('currentUser', JSON.stringify(userData));
    localStorage.setItem('loginTime', new Date().toISOString());
    
    // Store admin credentials for session restoration (needed for account creation)
    if (profile.role === 'admin') {
      localStorage.setItem('adminCredentials', JSON.stringify({ email, password }));
      console.log('✅ Admin credentials stored for session restoration');
    }

    showSuccessMessage('Login successful! Redirecting...', 'loginForm');
    setTimeout(() => redirectToRolePage(profile.role), 500);
    loginInProgress = false;
  } catch (error) {
    console.error('Login error:', error);
    let message = 'Login failed. Please try again.';

    // Handle authentication errors
    if (error.code === 'auth/user-not-found') {
      message = 'Email not found. Please check your email or contact your administrator to create an account.';
    } else if (error.code === 'auth/wrong-password') {
      message = 'Incorrect password for this email.';
    } else if (error.code === 'auth/invalid-login-credentials') {
      // Firebase 9.22+ returns this for wrong email/password
      message = 'Email or password is incorrect. Please try again.';
    } else if (error.code === 'auth/invalid-email') {
      message = 'Please enter a valid email address.';
    } else if (error.code === 'auth/user-disabled') {
      message = 'This account has been disabled. Please contact your administrator.';
    } else if (error.code === 'auth/too-many-requests') {
      message = 'Too many failed login attempts. Please try again in a few minutes.';
    }

    showErrorMessage(message, 'loginForm');
    loginInProgress = false;
  }
}

function switchTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => btn.classList.remove('active'));
  if (tab === 'login') {
    loginForm.classList.add('active');
    signupForm.classList.remove('active');
    tabBtns[0].classList.add('active');
  } else {
    loginForm.classList.remove('active');
    signupForm.classList.add('active');
    tabBtns[1].classList.add('active');
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showForgotPassword(event) {
  event.preventDefault();
  clearErrorMessage();
  const modal = document.getElementById('forgotPasswordModal');
  const emailInput = document.getElementById('resetEmail');
  if (modal) modal.classList.add('show');
  if (emailInput) emailInput.value = '';
}

function closeForgotPassword() {
  clearErrorMessage();
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) modal.classList.remove('show');
}

let resetInProgress = false;

async function handlePasswordReset(event) {
  event.preventDefault();
  clearErrorMessage();

  if (resetInProgress) {
    return;
  }

  const emailInput = document.getElementById('resetEmail');
  const submitButton = document.getElementById('resetSendButton');
  const email = emailInput ? emailInput.value.trim() : '';

  if (!email) {
    showErrorMessage('Please enter your email address.', 'forgotPasswordForm');
    return;
  }

  if (!validateEmail(email)) {
    showErrorMessage('Please enter a valid email address.', 'forgotPasswordForm');
    return;
  }

  resetInProgress = true;
  if (submitButton) submitButton.disabled = true;

  try {
    await sendPasswordResetEmail(auth, email);
    showSuccessMessage('If an account exists with that email, a reset link has been sent. Please check your email.', 'forgotPasswordForm');
  } catch (error) {
    console.error('Password reset error:', error);
    if (error.code === 'auth/invalid-email') {
      showErrorMessage('Please enter a valid email address.', 'forgotPasswordForm');
    } else if (error.code === 'auth/user-not-found') {
      showSuccessMessage('If an account exists with that email, a reset link has been sent. Please check your email.', 'forgotPasswordForm');
    } else if (error.code === 'auth/too-many-requests') {
      showErrorMessage('Too many password reset attempts. Please try again later.', 'forgotPasswordForm');
    } else {
      showErrorMessage('Unable to send password reset link right now. Please try again later.', 'forgotPasswordForm');
    }
  } finally {
    resetInProgress = false;
    if (submitButton) submitButton.disabled = false;
  }
}

window.showForgotPassword = showForgotPassword;
window.closeForgotPassword = closeForgotPassword;
window.handlePasswordReset = handlePasswordReset;
window.handleLogin = handleLogin;
window.switchTab = switchTab;

function checkAlreadyLoggedIn() {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) return;
    if (loginInProgress) return;

    const profile = await getUserProfile(firebaseUser.uid);
    if (!profile) {
      await signOut(auth);
      localStorage.removeItem('currentUser');
      return;
    }

    // If we have an existing local session that is inconsistent with selected login role,
    // we should not auto-redirect; instead force full login flow.
    const savedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (savedUser && savedUser.role !== profile.role) {
      await signOut(auth);
      localStorage.removeItem('currentUser');
      return;
    }

    const userData = {
      uid: profile.uid,
      name: profile.name || profile.email,
      email: profile.email,
      role: profile.role,
      studentId: profile.studentId || null,
      status: profile.status || null
    };
    localStorage.setItem('currentUser', JSON.stringify(userData));
    redirectToRolePage(profile.role);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await ensureDefaultAdmin();
  checkAlreadyLoggedIn();
  setupPasswordToggle();
});
