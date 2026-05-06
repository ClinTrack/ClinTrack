import { db, storage } from './firebase.js';
import { collection, doc, addDoc, getDocs, getDoc, deleteDoc, serverTimestamp, query, where, orderBy, updateDoc, arrayUnion, increment, runTransaction, onSnapshot } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js';
import { setupPortalMenu } from './portal-menu.js';

const SECTION_STORAGE_KEY = 'studentCurrentSection';

// Forum real-time listener
let forumListener = null;

// Process any pending function calls that were queued while module was loading
const processPendingCalls = () => {
  if (window.pendingCalls && Array.isArray(window.pendingCalls)) {
    setTimeout(() => {
      while (window.pendingCalls.length > 0) {
        const call = window.pendingCalls.shift();
        if (typeof window[call.fn] === 'function') {
          window[call.fn](...call.args);
        }
      }
    }, 0);
  }
};

document.addEventListener('DOMContentLoaded', function() {
  setupPortalMenu();
  removeLegacyStudentDutyRequirementPanel();
  processPendingCalls();
  
  // Restore the last viewed section on page reload
  const storedSection = getStoredSection();
  if (storedSection && document.getElementById(storedSection)) {
    showSection(storedSection);
  }
});

// Logout function
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    cleanupForumListener();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('loginTime');
    localStorage.removeItem(SECTION_STORAGE_KEY);
    window.location.href = 'login.html';
  }
}
window.logout = logout;

function toggleProfileMenu(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('profileDropdown');
  if (!dropdown) return;
  const isOpen = dropdown.classList.toggle('visible');
  const trigger = event.currentTarget;
  if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
}
window.toggleProfileMenu = toggleProfileMenu;

document.addEventListener('click', function(event) {
  if (!event.target.closest('.profile-menu')) {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) {
      dropdown.classList.remove('visible');
      const trigger = document.querySelector('.profile-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  }
});

function setActiveNavLink(sectionId) {
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.section === sectionId);
  });
}

function getStoredSection() {
  const storedSection = localStorage.getItem(SECTION_STORAGE_KEY) || 'dashboard';
  if (storedSection === 'dutyRequirement') {
    return 'classrooms';
  }
  return document.getElementById(storedSection) ? storedSection : 'dashboard';
}

function showSection(sectionId, event) {
  if (sectionId === 'dutyRequirement') {
    sectionId = 'classrooms';
  }

  const sections = document.querySelectorAll('.section');
  sections.forEach(section => section.classList.add('hidden'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.remove('hidden');
  if (event && event.currentTarget) {
    event.preventDefault();
  }
  setActiveNavLink(sectionId);
  localStorage.setItem(SECTION_STORAGE_KEY, sectionId);
  
  if (sectionId === 'classrooms') {
    renderStudentClassrooms();
  }

  // Set up forum listener when forum section is shown
  if (sectionId === 'forum') {
    loadForumDiscussions();
  } else {
    // Clean up forum listener when leaving forum section
    cleanupForumListener();
  }
}
window.showSection = showSection;

function removeLegacyStudentDutyRequirementPanel() {
  const legacySection = document.getElementById('dutyRequirement');
  if (legacySection) {
    legacySection.remove();
  }

  const legacyNavLink = document.querySelector('.nav-link[data-section="dutyRequirement"]');
  if (legacyNavLink && legacyNavLink.parentElement) {
    legacyNavLink.parentElement.remove();
  }
}

const studentLabNotesStore = {};

// Display student name from logged-in user
function displayStudentName() {
  const currentUser = localStorage.getItem('currentUser');
  if (currentUser) {
    const user = JSON.parse(currentUser);
    const profileNameElement = document.getElementById('profileName');
    const roleLabel = document.getElementById('roleLabel');
    if (profileNameElement && roleLabel) {
      profileNameElement.textContent = user.name;
      roleLabel.textContent = user.role === 'student' ? '👤 Student:' : (user.role === 'instructor' ? '👤 Instructor:' : '👤 User:');
    }
    // Role-based UI
    if (user.role === 'instructor') {
      // Hide student-only features
      document.getElementById('scheduleBtn').style.display = 'none';
      document.getElementById('labBtn').style.display = 'none';
    }
  }
}

async function populateInstructorSelects() {
  const instructorSelects = [document.getElementById('studentLabInstructor'), document.getElementById('dutyLinkInstructor')];
  instructorSelects.forEach(select => {
    if (select) select.innerHTML = '<option value="" style = >Select Instructors             ▼</option>';
  });

  // Local data fallback for non-Firestore setups
  const adminData = getAdminData();
  const localInstructors = (adminData.instructors || []).filter(i => i.name || i.email);
  localInstructors.forEach(instr => {
    const value = instr.uid || instr.id || instr.instructorId || instr.email || instr.name;
    const label = instr.name || instr.email || 'Instructor';
    instructorSelects.forEach(select => {
      if (select) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      }
    });
  });

  try {
    const usersSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'instructor')));
    usersSnapshot.forEach(docSnap => {
      const instructor = docSnap.data();
      const value = docSnap.id;
      const label = instructor.name || instructor.email || 'Instructor';
      instructorSelects.forEach(select => {
        if (select) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
      });
    });
  } catch (error) {
    console.error('Failed to load instructors for student selects:', error);
  }
}

// Initialize app on page load
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { auth } from './firebase.js';

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // 🔥 NOW user is authenticated
  displayStudentName();
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const profileNameElement = document.getElementById('profileName');
  if (profileNameElement && currentUser.name) {
    profileNameElement.textContent = currentUser.name;
  }

  await loadStudentData();
  await loadAllSectionsFromFirestore();
  await loadStudentEnrolledSectionsFromFirestore();
  loadNotesFromStorage();
  setupEventListeners();
  await populateInstructorSelects();
  setupStudentSubmissionListeners();
  setupStudentSectionJoin();
  renderStudentSections();
  renderStudentClassrooms();
await loadAnnouncementsFromFirestore();
  initializeDutyRequirement();
  setupDutyRequirementFilters();

  showNotification('Welcome back! 👋', 'info');

  const currentSection = getStoredSection();
  showSection(currentSection);
});

function getAdminData() {
  return JSON.parse(localStorage.getItem('nursingHubAdminData') || '{}');
}

function saveAdminData(data) {
  localStorage.setItem('nursingHubAdminData', JSON.stringify(data));
}

function getAllSections() {
  const adminData = getAdminData();
  return adminData.sections || [];
}

async function loadAllSectionsFromFirestore() {
  try {
    const snapshot = await getDocs(collection(db, 'sections'));
    const sections = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    const adminData = getAdminData();
    adminData.sections = sections;
    saveAdminData(adminData);
    return sections;
  } catch (error) {
    console.error('Failed to load sections from Firestore:', error);
    return getAllSections();
  }
}

async function loadStudentEnrolledSectionsFromFirestore() {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const userId = currentUser.uid || currentUser.id || '';
    
    if (!userId) return;
    
    const snapshot = await getDocs(collection(db, 'sections'));
    const enrolledSections = [];
    
    snapshot.forEach(docSnap => {
      const sectionData = docSnap.data();
      const students = sectionData.students || [];
      
      // Check if current user is enrolled in this section
      const isEnrolled = students.some(s => 
        s.id === userId || s.email === currentUser.email
      );
      
      if (isEnrolled) {
        enrolledSections.push({ 
          id: docSnap.id, 
          ...sectionData 
        });
      }
    });
    
    // Save enrolled sections to localStorage
    saveStudentSections(enrolledSections);
    return enrolledSections;
  } catch (error) {
    console.error('Failed to load student enrolled sections from Firestore:', error);
    return getStudentSections();
  }
}

function getStudentSections() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const key = `studentSections_${currentUser.uid || currentUser.uid || currentUser.email || 'unknown'}`;
  return JSON.parse(localStorage.getItem(key) || '[]');
}

function populateDutySectionSelect() {
  const select = document.getElementById('dutySectionSelect');
  if (!select) return;
  const sections = getStudentSections();
  select.innerHTML = '<option value="">Select Joined Section</option>';
  sections.forEach(section => {
    const option = document.createElement('option');
    option.value = section.id || section.firestoreId || '';
    option.textContent = `${section.name}${section.code ? ' (' + section.code + ')' : ''}`;
    select.appendChild(option);
  });
}

function saveStudentSections(sections) {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const key = `studentSections_${currentUser.uid || currentUser.uid || currentUser.email || 'unknown'}`;
  localStorage.setItem(key, JSON.stringify(sections));
}

function updateJoinedSectionCount(sections = []) {
  const countEl = document.getElementById('joinedSectionCount');
  if (countEl) {
    countEl.textContent = String((sections || []).length);
  }
}

function renderStudentSections() {
  const container = document.getElementById('studentSectionsContainer');
  const sections = getStudentSections();
  const now = new Date();

  updateJoinedSectionCount(sections);
  if (!container) return;

  if (!sections || sections.length === 0) {
    container.innerHTML = '<p style="color:#999;">No sections joined yet.</p>';
    return;
  }

  const rows = sections.map(s => {
    const expiryText = s.expiresAt ? (new Date(s.expiresAt) < now ? 'Expired' : new Date(s.expiresAt).toLocaleDateString()) : 'No expiry';
    return `
      <div style="border:1px solid #e5e7eb; padding:10px; border-radius:8px; margin-bottom:8px;">
        <div style="font-weight:600;">${escapeHtml(s.name)} <span style="font-size:12px; color:#555;">(${escapeHtml(s.subject)})</span></div>
        <div style="font-size:12px; color:#555; margin-top:4px;">Instructor: ${escapeHtml(s.instructorName)} | Code: ${escapeHtml(s.code)} | Expires: ${escapeHtml(expiryText)}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = rows;
}

function renderStudentClassrooms() {
  const container = document.getElementById('studentClassroomsContainer');
  if (!container) return;

  const sections = getStudentSections();
  updateJoinedSectionCount(sections);

  if (!sections || sections.length === 0) {
    container.innerHTML = '<div style="color:#999; padding:12px; border:1px dashed #cbd5e1; border-radius:8px;">No joined sections. Join a section with code to get started.</div>';
    document.getElementById('studentClassroomDetail').innerHTML = '';
    return;
  }

  const cards = sections.map(section => {
    const sectionColor = section.color || '#C8102E';
    return `
      <div style="display:flex; align-items:center; padding:16px; background:white; border:1px solid #e5e7eb; border-left:4px solid ${sectionColor}; border-radius:8px; cursor:pointer; margin-bottom:12px; transition:all 0.3s ease;" onclick="openStudentClassroom('${escapeHtml(section.id)}')">
        <div style="flex:1;">
          <h4 style="margin:0; font-size:16px; color:${sectionColor};">${escapeHtml(section.name)}</h4>
          <div style="margin-top:8px; font-size:13px; color:#666;">
            <div>• Instructor: ${escapeHtml(section.instructorName || 'Instructor')}</div>
            <div>• Code: ${escapeHtml(section.code)}</div>
          </div>
        </div>
        <div style="font-size:24px; color:${sectionColor}; margin-left:12px;">›</div>
      </div>
    `;
  }).join('');

  container.innerHTML = cards;
  document.getElementById('studentClassroomDetail').innerHTML = '';
}

function openStudentClassroom(sectionId) {
  const sections = getStudentSections();
  const section = sections.find(s => s.id === sectionId || s.firestoreId === sectionId);
  if (!section) {
    showNotification('Section not found', 'error');
    return;
  }
  renderStudentClassroomDetail(section, 'requirements');
}

async function renderStudentClassroomDetail(section, activeTab = 'requirements') {
  const detail = document.getElementById('studentClassroomDetail');
  if (!detail) return;

  const sectionId = section.id || section.firestoreId || '';
  const sectionColor = section.color || '#0f172a';
  const tabs = [
    { id: 'requirements', label: 'Duty Requirements' },
    { id: 'people', label: 'People' }
  ];

  const classworkItems = section.classwork || [];
  const announcements = section.announcements || [];
  const materials = section.materials || [];
  const people = section.students || [];

  const tabButtons = tabs.map(tab => `
    <button class="primary" style="background:${activeTab===tab.id? sectionColor:'#f1f5f9'}; color:${activeTab===tab.id? 'white':'#1e293b'}; margin-right:8px;" onclick="renderStudentClassroomDetailById('${escapeHtml(sectionId)}','${tab.id}')">${tab.label}</button>
  `).join('');

  let content = '';

  if (activeTab === 'people') {
    content = `
      <h4><i class="fa-solid fa-users"></i> People</h4>
      <p style="font-size:13px; color:#4b5563;">Instructor and students in this section.</p>
      <div style="margin-bottom:10px;"><strong>Instructor:</strong> ${escapeHtml(section.instructorName || 'Instructor')}</div>
      <div style="margin-top:16px;">
        <strong style="display:block; margin-bottom:8px;">Students:</strong>
        <div style="margin-left:0;">
          ${people.length === 0 ? '<p style="color:#999;">No students joined yet.</p>' : '<ul style="margin:0; padding-left:20px;">' + people.map(p => `<li style="margin-bottom:4px;">${escapeHtml(p.name || p.studentName || p.email || 'Student')}</li>`).join('') + '</ul>'}
        </div>
      </div>
    `;
  } else if (activeTab === 'requirements') {
    content = `
      <h4>Duty Requirements</h4>
      <p style="font-size:13px; color:#4b5563; margin-bottom:12px;">Submit requirement links directly to <strong>${escapeHtml(section.instructorName || 'your instructor')}</strong> through this classroom.</p>
      <div style="margin-bottom:16px; padding:14px; background:#f8fafc; border:1px solid #dbe4f0; border-radius:10px;">
        <div style="font-size:13px; color:#475569; margin-bottom:10px;"><strong>Section:</strong> ${escapeHtml(section.name)}${section.code ? ` (${escapeHtml(section.code)})` : ''}</div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
          <select id="classroomDutyType" style="padding: 10px; border: 2px solid #e5e7eb; border-radius: 8px; width: 100%;">
            <option value="">Select Requirement Type</option>
            <option value="Learning Feedback Diary">Learning Feedback Diary</option>
            <option value="Drug Study">Drug Study</option>
            <option value="Nursing Care Plan">Nursing Care Plan</option>
          </select>
          <input id="classroomDutyLink" placeholder="Paste document link here" style="padding: 10px; border:2px solid #e5e7eb; border-radius: 8px; width: 100%;" />
          <button class="primary" id="submitClassroomDutyLinkBtn" style="padding: 10px;" onclick="submitDutyLink('${escapeHtml(sectionId)}')">Submit Link</button>
        </div>
      </div>
      <div style="padding: 16px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb;">
        <h5 style="margin-bottom: 12px; color: #333;">My Submissions for ${escapeHtml(section.name)}</h5>
        <div id="studentSectionFilesList">
          <p style="text-align: center; color: #999; padding: 20px;">Loading submissions...</p>
        </div>
      </div>
    `;
  }

  detail.innerHTML = `
    <div class="card" style="padding: 12px;">
      <h3>${escapeHtml(section.name)} <small style="color:#555;">${escapeHtml(section.subject || '')}</small></h3>
      <div>${tabButtons}</div>
      <div style="margin-top:12px;">${content}</div>
    </div>
  `;

  if (activeTab === 'requirements') {
    await loadStudentDutyFiles(sectionId, 'studentSectionFilesList');
  }
}

async function renderStudentClassroomDetailById(sectionId, tab) {
  const sections = getStudentSections();
  const section = sections.find(s => s.id === sectionId || s.firestoreId === sectionId);
  if (!section) return;
  await renderStudentClassroomDetail(section, tab);
}

window.openStudentClassroom = openStudentClassroom;
window.renderStudentClassroomDetailById = renderStudentClassroomDetailById;

window.submitStudentAssignment = async function(sectionId) {
  const text = document.getElementById('studentSubmitText')?.value.trim();
  const status = document.getElementById('submissionStatus');
  if (!text) {
    showNotification('Enter submission content', 'warning');
    return;
  }
  let sections = getStudentSections();
  const sectionIndex = sections.findIndex(s => s.id === sectionId);
  if (sectionIndex === -1) return;

  const submission = {
    id: `sub_${Date.now()}`,
    studentId: JSON.parse(localStorage.getItem('currentUser') || '{}').id,
    text,
    createdAt: new Date().toISOString()
  };

  const studentSubmissions = JSON.parse(localStorage.getItem(`classroomSubmissions_${sectionId}`) || '[]');
  studentSubmissions.push(submission);
  localStorage.setItem(`classroomSubmissions_${sectionId}`, JSON.stringify(studentSubmissions));

  status.textContent = 'Assignment submitted.';
  status.style.color = '#059669';
  document.getElementById('studentSubmitText').value = '';
};

window.scrollClassroomStream = function(sectionId) {
  openStudentClassroom(sectionId);
};

async function enrollStudentToSectionInFirestore(sectionId) {
  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const sectionRef = doc(db, 'sections', sectionId);
    const sectionDoc = await getDoc(sectionRef);
    if (!sectionDoc.exists()) return;

    const sectionData = sectionDoc.data();
    const students = sectionData.students || [];
    const found = students.some(s => s.id === currentUser.uid || s.id === currentUser.uid || s.email === currentUser.email);
    if (!found) {
      students.push({ id: currentUser.uid||currentUser.uid||'', name: currentUser.name||'', email: currentUser.email||'', joinedAt: new Date().toISOString() });
      await updateDoc(sectionRef, { students });
    }
  } catch (error) {
    console.error('Unable to register student in section people list:', error);
  }
};

async function joinSectionByCode(code) {
  const joinedSections = getStudentSections();

  const normalized = String(code).trim().toUpperCase();
  if (!normalized) {
    showNotification('Please enter a section code.', 'warning');
    return;
  }

  let target;
  try {
    const snapshot = await getDocs(query(collection(db, 'sections'), where('code', '==', normalized)));
    if (!snapshot.empty) {
      const docSnap = snapshot.docs[0];
      target = { id: docSnap.id, ...docSnap.data() };
    }
  } catch (error) {
    console.error('Failed to verify section code from Firestore:', error);
    showNotification('Unable to verify section code. Please try again later.', 'error');
    return;
  }

  if (!target) {
    showNotification('Invalid section code. Please check with your instructor.', 'error');
    return;
  }

  if (target.expiresAt && new Date(target.expiresAt) < new Date()) {
    showNotification('Section code has expired. Ask your instructor for a new one.', 'error');
    return;
  }

  if (joinedSections.some(s => s.id === target.id)) {
    showNotification('You are already enrolled in this section.', 'info');
    return;
  }

  const newSections = [...joinedSections, target];
  saveStudentSections(newSections);
  renderStudentSections();
  renderStudentClassrooms();
  await enrollStudentToSectionInFirestore(target.id);
  showNotification('Successfully joined section.', 'success');
}

async function loadStudentData() {
  const currentUser = localStorage.getItem('currentUser');
  if (!currentUser) return;

  const user = JSON.parse(currentUser);
  const adminData = getAdminData();
  const studentIdKey = user.id || user.studentId || '';

  const localSchedules = (adminData.schedules || []).filter(s =>
    s.studentUid === studentIdKey ||
    s.studentId === studentIdKey ||
    s.studentLegacyId === studentIdKey ||
    s.studentUid === user.id ||
    s.studentId === user.studentId ||
    s.studentLegacyId === user.studentId ||
    s.studentId === user.email ||
    s.studentName === user.name
  );

  const localDemos = (adminData.demonstrations || []).filter(d =>
    d.studentUid === studentIdKey ||
    d.studentId === studentIdKey ||
    d.studentLegacyId === studentIdKey ||
    d.studentUid === user.id ||
    d.studentId === user.studentId ||
    d.studentLegacyId === user.studentId ||
    d.studentId === user.email ||
    d.studentName === user.name
  );

  const localLabs = (adminData.labs || []).filter(l =>
    l.studentUid === studentIdKey ||
    l.studentId === studentIdKey ||
    l.studentLegacyId === studentIdKey ||
    l.studentUid === user.id ||
    l.studentId === user.studentId ||
    l.studentLegacyId === user.studentId ||
    l.studentId === user.email ||
    l.studentName === user.name
  );

  let firestoreSchedules = [];
  let firestoreDemos = [];
  let firestoreLabs = [];

  try {
    const scheduleSnapshot = await getDocs(collection(db, 'schedules'));
    scheduleSnapshot.forEach(docSnap => {
      const s = docSnap.data();
      if (!s) return;
      if (
        s.studentUid === studentIdKey ||
        s.studentId === studentIdKey ||
        s.studentLegacyId === studentIdKey ||
        s.studentUid === user.id ||
        s.studentId === user.studentId ||
        s.studentLegacyId === user.studentId ||
        s.studentId === user.email ||
        s.studentName === user.name
      ) {
        firestoreSchedules.push({ id: docSnap.id, ...s });
      }
    });

    const demoSnapshot = await getDocs(collection(db, 'demonstrations'));
    demoSnapshot.forEach(docSnap => {
      const d = docSnap.data();
      if (!d) return;
      if (
        d.studentUid === studentIdKey ||
        d.studentId === studentIdKey ||
        d.studentLegacyId === studentIdKey ||
        d.studentUid === user.id ||
        d.studentId === user.studentId ||
        d.studentLegacyId === user.studentId ||
        d.studentId === user.email ||
        d.studentName === user.name
      ) {
        firestoreDemos.push({ id: docSnap.id, ...d });
      }
    });

    const labSnapshot = await getDocs(collection(db, 'labs'));
    labSnapshot.forEach(docSnap => {
      const l = docSnap.data();
      if (!l) return;
      if (
        l.studentUid === studentIdKey ||
        l.studentId === studentIdKey ||
        l.studentLegacyId === studentIdKey ||
        l.studentUid === user.id ||
        l.studentId === user.studentId ||
        l.studentLegacyId === user.studentId ||
        l.studentId === user.email ||
        l.studentName === user.name
      ) {
        firestoreLabs.push({ id: docSnap.id, ...l });
      }
    });
  } catch (error) {
    console.error('Error loading Firestore student data:', error);
  }

  const dedupe = (items) => {
    const map = new Map();
    items.forEach(item => {
      const key = item.firestoreId || item.id || `${item.studentId || item.studentUid || ''}-${item.date || item.testName || item.procedure || ''}-${item.shift || ''}`;
      if (!map.has(key)) map.set(key, item);
    });
    return [...map.values()];
  };

  const schedules = dedupe([...localSchedules, ...firestoreSchedules]);
  const demos = dedupe([...localDemos, ...firestoreDemos]);
  const labs = dedupe([...localLabs, ...firestoreLabs]);

  loadSchedulesTable(schedules);
  loadDemosTable(demos);
  loadLabsTable(labs);
  updateStudentStats(schedules, demos, labs);
}

function setupStudentSubmissionListeners() {
  const submitLabBtn = document.getElementById('submitLabBtn');
  if (submitLabBtn) {
    submitLabBtn.addEventListener('click', async function() {
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const testName = document.getElementById('studentLabTestName').value.trim();
      const result = document.getElementById('studentLabResult').value.trim();
      const date = document.getElementById('studentLabDate').value;
      const instructor = document.getElementById('studentLabInstructor').value;
      const notes = document.getElementById('studentLabNotes').value.trim();

      if (!testName || !result || !date || !instructor) {
        showNotification('Please fill lab test name, result, date, and select instructor.', 'warning');
        return;
      }

      const adminData = getAdminData();
      const labEntry = {
        studentName: currentUser.name || 'Student',
        studentId: currentUser.studentId || currentUser.uid || '',
        studentUid: currentUser.uid || currentUser.uid || '',
        testName,
        date,
        result,
        notes,
        instructorId: instructor,
        instructor: document.getElementById('studentLabInstructor').selectedOptions[0].textContent,
        createdAt: serverTimestamp()
      };

      adminData.labs = adminData.labs || [];
      const localLabId = 'lab_' + Date.now();
      adminData.labs.push({ id: localLabId, ...labEntry });
      saveAdminData(adminData);

      try {
        const docRef = await addDoc(collection(db, 'labs'), labEntry);
        const index = adminData.labs.findIndex(l => l.id === localLabId);
        if (index !== -1) {
          adminData.labs[index].firestoreId = docRef.id;
          saveAdminData(adminData);
        }
      } catch (err) {
        console.error('Failed to save lab to Firestore:', err);
      }

      await loadStudentData();
      clearStudentLabForm();
      showNotification('Lab test submitted for instructor review.', 'success');
    });
  }
}

function setupStudentSectionJoin() {
  const joinBtn = document.getElementById('joinSectionBtn');
  if (!joinBtn) return;

  joinBtn.addEventListener('click', async function() {
    const codeInput = document.getElementById('sectionCodeInput');
    const message = document.getElementById('joinSectionMessage');
    if (!codeInput) return;

    const code = codeInput.value.trim();
    if (!code) {
      if (message) {
        message.textContent = 'Please enter a section code.';
        message.style.color = '#c62828';
      }
      showNotification('Please enter a section code.', 'warning');
      return;
    }

    await joinSectionByCode(code);
    codeInput.value = '';
    populateDutySectionSelect();
    if (message) {
      message.textContent = '';
    }
  });
}

function clearStudentLabForm() {
  ['studentLabTestName', 'studentLabResult', 'studentLabDate', 'studentLabInstructor', 'studentLabNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = ''; 
  });
  const instructorSel = document.getElementById('studentLabInstructor');
  if (instructorSel) instructorSel.value = '';
}

// Load schedules table
function loadSchedulesTable(schedules) {
  const tbody = document.getElementById('scheduleBody');
  tbody.innerHTML = '';
  
  if (schedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999; padding: 20px;">No scheduled duties yet. Check back later!</td></tr>';
    return;
  }
  
  schedules.forEach(schedule => {
    const row = document.createElement('tr');
    
    // Format date: if it's a valid ISO date, parse it; otherwise display as entered
    let formattedDate = schedule.date;
    const parsedDate = new Date(schedule.date);
    if (!isNaN(parsedDate.getTime()) && schedule.date.match(/^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{4}/)) {
      formattedDate = parsedDate.toLocaleDateString();
    }
    
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${schedule.hospital}</td>
      <td>${schedule.ward}</td>
      <td>${schedule.shift}</td>
      <td>${schedule.instructor}</td>
    `;
    tbody.appendChild(row);
  });
}

// Load demonstrations table
function loadDemosTable(demos) {
  const tbody = document.getElementById('demoBody');
  if (!tbody) {
    // If the demo table is not present in the current UI, skip rendering.
    return;
  }

  tbody.innerHTML = '';
  
  if (demos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999; padding: 20px;">No demonstrations recorded yet.</td></tr>';
    return;
  }
  
  demos.forEach(demo => {
    const row = document.createElement('tr');
    const gradeClass = demo.grade >= 80 ? 'status-completed' : (demo.grade >= 70 ? 'status-pending' : 'status-warning');
    row.innerHTML = `
      <td>${demo.procedure}</td>
      <td>${new Date(demo.date).toLocaleDateString()}</td>
      <td><span class="status-badge ${gradeClass}">${demo.grade}%</span></td>
      <td>${demo.feedback || 'N/A'}</td>
      <td>${demo.instructor || 'N/A'}</td>
    `;
    tbody.appendChild(row);
  });
}

// Load labs table
function loadLabsTable(labs) {
  const tbody = document.getElementById('labBody');
  tbody.innerHTML = '';
  
  if (labs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999; padding: 20px;">No lab tests recorded yet.</td></tr>';
    return;
  }
  
  labs.forEach(lab => {
    const notePreview = lab.notes ? (lab.notes.length > 40 ? `${lab.notes.slice(0, 40)}...` : lab.notes) : 'No notes';
    studentLabNotesStore[lab.id || lab.firestoreId || `${lab.studentId || ''}_${lab.date}`] = {
      notes: lab.notes || '',
      testName: lab.testName || 'Lab Test',
      date: lab.date || ''
    };

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${lab.testName}</td>
      <td>${new Date(lab.date).toLocaleDateString()}</td>
      <td>${lab.result || 'N/A'}</td>
      <td>${lab.instructor || 'N/A'}</td>
      <td>${lab.notes ? `<button class="notes-preview-btn" type="button" onclick="openStudentLabNotesModal('${lab.id || lab.firestoreId || `${lab.studentId || ''}_${lab.date}` }')">${escapeHtml(notePreview)}</button>` : 'N/A'}</td>
    `;
    tbody.appendChild(row);
  });
}

function openStudentLabNotesModal(labKey) {
  const record = studentLabNotesStore[labKey];
  if (!record) {
    showNotification('Lab notes not found.', 'warning');
    return;
  }

  const modal = ensureStudentLabNotesModal();
  modal.querySelector('.modal-title').textContent = `Lab Notes`;
  modal.querySelector('.modal-subtitle').textContent = `${record.testName} · ${record.date ? new Date(record.date).toLocaleDateString() : 'Unknown date'}`;
  modal.querySelector('.modal-body').textContent = record.notes || 'No notes provided.';
  modal.classList.remove('hidden');
}

function closeStudentLabNotesModal() {
  const modal = document.getElementById('studentLabNotesModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function ensureStudentLabNotesModal() {
  let modal = document.getElementById('studentLabNotesModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'studentLabNotesModal';
  modal.className = 'notes-modal hidden';
  modal.innerHTML = `
    <div class="notes-modal-content">
      <div class="notes-modal-header">
        <h3 class="modal-title">Lab Notes</h3>
        <button class="close-modal" type="button">✕</button>
      </div>
      <div class="modal-subtitle"></div>
      <div class="modal-body"></div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('.close-modal').addEventListener('click', closeStudentLabNotesModal);
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeStudentLabNotesModal();
    }
  });

  return modal;
}

window.openStudentLabNotesModal = openStudentLabNotesModal;
window.closeStudentLabNotesModal = closeStudentLabNotesModal;

// Update student stats
function updateStudentStats(schedules, demos, labs) {
  const scheduleCountEl = document.getElementById('scheduleCount');
  const demoCountEl = document.getElementById('demoCount');
  const labCountEl = document.getElementById('labCount');

  if (scheduleCountEl) scheduleCountEl.textContent = schedules.length;
  if (demoCountEl) demoCountEl.textContent = demos.length;
  if (labCountEl) labCountEl.textContent = labs.length;
}

// Priority utility functions (shared with instructor/admin)
function getPriorityValue(priority) {
  switch (priority?.toLowerCase() || 'normal') {
    case 'urgent': return 3;
    case 'important': return 2;
    case 'normal': return 1;
    default: return 1;
  }
}

function getPriorityInfo(priority) {
  const p = priority?.toLowerCase() || 'normal';
  const infos = {
    normal: { emoji: '💬', color: '#3b82f6', label: 'Normal', className: 'priority-normal' },
    important: { emoji: '⚠️', color: '#f59e0b', label: 'Important', className: 'priority-important' },
    urgent: { emoji: '🚨', color: '#ef4444', label: 'Urgent', className: 'priority-urgent pinned-top' }
  };
  return infos[p] || infos.normal;
}

async function loadAnnouncementsFromFirestore() {
  const container = document.getElementById('announcementsContainer');
  if (!container) return;

  container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Loading announcements...</p>';

  try {
    const snapshot = await getDocs(query(collection(db, 'forum'), orderBy('createdAt', 'desc')));
    let announcements = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .filter(item => item.type === 'announcement');

    // PRIORITY SORT: Urgent first, then createdAt DESC within same priority
    announcements.sort((a, b) => {
      const prioA = getPriorityValue(a.priority);
      const prioB = getPriorityValue(b.priority);
      if (prioA !== prioB) return prioB - prioA;
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    if (announcements.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No announcements yet. Check back for instructor updates.</p>';
      return;
    }

    container.innerHTML = '';
    announcements.forEach(announcement => {
      const priorityInfo = getPriorityInfo(announcement.priority);
      const card = document.createElement('div');
      card.className = `post ${priorityInfo.className}`;
      card.style.borderLeftColor = priorityInfo.color;
      const createdAt = announcement.createdAt?.toDate ? announcement.createdAt.toDate() : new Date(announcement.createdAt || new Date());
      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const currentUserId = currentUser.uid || currentUser.id || '';
      const isOwnAnnouncement = announcement.authorId === currentUserId;
      const deleteBtn = isOwnAnnouncement ? `<button class="announcement-delete-btn" onclick="deleteOwnAnnouncement('${announcement.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;">🗑️ Delete</button>` : '';
      card.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 15px;">${priorityInfo.emoji} ${escapeHtml(announcement.title || 'Announcement')}</strong>
            ${deleteBtn}
          </div>
          <span style="font-size: 12px; color: #6b7280; font-weight: 500;">Posted by ${escapeHtml(announcement.authorName || 'Unknown')} (${escapeHtml(announcement.role || 'User')})</span>
        </div>
        <div style="margin-bottom: 8px; color: #555; font-size: 14px; word-break: break-word; overflow-wrap: anywhere; line-height: 1.5;">${escapeHtml(announcement.message || announcement.text || '')}</div>
        <div class="timestamp" style="margin-top: 0; font-size: 12px; color: #9ca3af;">
          <span class="priority-badge">${priorityInfo.label}</span> • 
          ${createdAt.toLocaleString()}
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Failed to load announcements from Firestore:', error);
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load announcements right now.</p>';
  }
}

window.deleteOwnAnnouncement = async function(announcementId) {
  if (!confirm('Are you sure you want to delete your announcement?')) return;
  
  try {
    await deleteDoc(doc(db, 'forum', announcementId));
    showNotification('Announcement deleted successfully.', 'success');
    await loadAnnouncementsFromFirestore(); // Refresh announcements
  } catch (error) {
    console.error('Failed to delete announcement:', error);
    showNotification('Failed to delete announcement. Please try again.', 'error');
  }
};

// Announcement POST functions (Student)
function openStudentAnnouncementModal() {
  const modal = document.getElementById('studentAnnouncementModal');
  if (modal) {
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
  }
}
window.openStudentAnnouncementModal = openStudentAnnouncementModal;

function closeStudentAnnouncementModal() {
  const modal = document.getElementById('studentAnnouncementModal');
  if (modal) {
    modal.style.display = 'none';
  }
}
window.closeStudentAnnouncementModal = closeStudentAnnouncementModal;

async function addStudentAnnouncement(event) {
  event.preventDefault();
  
  const title = document.getElementById('studentAnnouncementTitle').value.trim();
  const message = document.getElementById('studentAnnouncementMessage').value.trim();
  const priority = document.getElementById('studentAnnouncementPriority').value;

  if (!title || !message) {
    showNotification('Please provide title and message.', 'warning');
    return;
  }

  try {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
await addDoc(collection(db, 'forum'), {
      type: 'announcement',
      title,
      message,
      priority,
      authorId: currentUser.uid || currentUser.id || '',
      authorName: currentUser.name || 'Student',
      role: 'student',
      createdAt: serverTimestamp()
    });

    closeStudentAnnouncementModal();
    document.getElementById('studentAnnouncementTitle').value = '';
    document.getElementById('studentAnnouncementMessage').value = '';
    document.getElementById('studentAnnouncementPriority').value = 'Normal';
    
    showNotification('✅ Announcement posted!', 'success');
    await loadAnnouncementsFromFirestore(); // Refresh list
  } catch (error) {
    console.error('Failed to post announcement:', error);
    showNotification('❌ Failed to post announcement.', 'error');
  }
}
window.addStudentAnnouncement = addStudentAnnouncement;

async function loadForumDiscussions() {
  const container = document.getElementById('forumPosts');
  if (!container) return;

  // Clean up existing listener
  if (forumListener) {
    forumListener();
    forumListener = null;
  }

  container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Loading forum discussions...</p>';

  try {
    const forumQuery = query(collection(db, 'forum'), orderBy('createdAt', 'desc'));
    
    forumListener = onSnapshot(forumQuery, (snapshot) => {
      const posts = snapshot.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(item => item.type === 'discussion');

      if (posts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No forum discussions yet.</p>';
        return;
      }

      container.innerHTML = '';
      posts.forEach(postData => {
        const post = createForumPostElement(
          postData.text,
          postData.authorName,
          postData.role,
          postData.createdAt,
          postData.id,
          postData.authorId,
          postData.reactions,
          postData.comments,
          postData.reactedBy
        );
        container.appendChild(post);
      });
    }, (error) => {
      console.error('Failed to listen to forum discussions:', error);
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load forum discussions right now.</p>';
    });
  } catch (error) {
    console.error('Failed to set up forum listener:', error);
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load forum discussions right now.</p>';
  }
}

function cleanupForumListener() {
  if (forumListener) {
    forumListener();
    forumListener = null;
  }
}

async function addForumPost() {
  const input = document.getElementById('forumInput');
  const charCountEl = document.getElementById('forumCharCount');
  const text = input.value.trim();

  if (text === '') {
    showNotification('Please write a discussion first! ✍️', 'warning');
    return;
  }
  if (text.length > 500) {
    showNotification('Discussion is too long! (Max 500 characters)', 'warning');
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const authorName = currentUser.name || 'Unknown';
  const role = currentUser.role || 'student';
  const authorId = currentUser.uid || currentUser.id || '';

  try {
    await addDoc(collection(db, 'forum'), {
      type: 'discussion',
      text,
      authorName,
      authorId,
      role,
      reactions: { like: 0, love: 0, wow: 0 },
      reactedBy: [],
      comments: [],
      createdAt: serverTimestamp()
    });
    input.value = '';
    if (charCountEl) {
      charCountEl.textContent = '0 / 500';
    }
    showNotification('Discussion posted!', 'success');
  } catch (error) {
    console.error('Failed to post discussion to Firestore:', error);
    showNotification('Unable to post discussion. Please try again.', 'error');
  }
}

// Expose the function for inline onclick in module-based pages
window.addForumPost = addForumPost;

async function reactToPost(postId, reactionType) {
  if (!postId || !reactionType) return;

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const userId = currentUser.uid || currentUser.id || '';
  if (!userId) {
    showNotification('Please log in to react.', 'warning');
    return;
  }

  try {
    const postRef = doc(db, 'forum', postId);
    const reactionMessage = await runTransaction(db, async (transaction) => {
      const postSnap = await transaction.get(postRef);
      if (!postSnap.exists()) return null;

      const postData = postSnap.data();
      const reactedBy = Array.isArray(postData.reactedBy) ? postData.reactedBy : [];
      const existingReaction = reactedBy.find(item => item.userId === userId);

      let newReactedBy = reactedBy.slice();
      let message = '';
      const updatePayload = {};

      if (existingReaction && existingReaction.reactionType === reactionType) {
        newReactedBy = newReactedBy.filter(item => item.userId !== userId);
        updatePayload[`reactions.${reactionType}`] = increment(-1);
      } else if (existingReaction) {
        newReactedBy = newReactedBy.filter(item => item.userId !== userId);
        newReactedBy.push({ userId, reactionType });
        updatePayload[`reactions.${existingReaction.reactionType}`] = increment(-1);
        updatePayload[`reactions.${reactionType}`] = increment(1);
      } else {
        newReactedBy.push({ userId, reactionType });
        updatePayload[`reactions.${reactionType}`] = increment(1);
      }

      updatePayload.reactedBy = newReactedBy;
      transaction.update(postRef, updatePayload);
      return message;
    });
    if (reactionMessage) {
      showNotification(reactionMessage, 'success');
    }
  } catch (error) {
    console.error('Failed to update reaction:', error);
    showNotification('Unable to record reaction. Please try again.', 'error');
  }
}

async function addCommentToPost(postId, commentText) {
  if (!commentText || !postId) return;
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const authorName = currentUser.name || 'Unknown';
  const role = currentUser.role || 'student';
  const authorId = currentUser.uid || currentUser.id || '';

  try {
    await updateDoc(doc(db, 'forum', postId), {
      comments: arrayUnion({
        id: `cmt_${Date.now()}`,
        authorName,
        authorId,
        role,
        text: commentText,
        createdAt: new Date().toISOString()
      })
    });
  } catch (error) {
    console.error('Failed to add comment:', error);
    showNotification('Unable to post comment. Please try again.', 'error');
  }
}

function getReactionLabel(type) {
  return {
    like: '👍 Like',
    love: '❤️ Love',
    wow: '😮 Wow'
  }[type] || type;
}

function formatCommentText(comment, postId) {
  const createdAt = comment.createdAt?.toDate ? comment.createdAt.toDate() : new Date(comment.createdAt || Date.now());
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const userId = currentUser.uid || currentUser.id || '';
  const canDeleteComment = userId && (currentUser.uid === comment.authorId || currentUser.id === comment.authorId || currentUser.role === 'admin');
  const deleteBtn = canDeleteComment ? `<button class="delete-comment" onclick="deleteComment('${postId}', '${comment.id}')" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:12px;margin-left:8px;">Delete</button>` : '';
  return `
    <div class="comment-item">
      <strong>${escapeHtml(comment.authorName || 'Anonymous')} (${escapeHtml(comment.role || 'student')})</strong>
      <div style="font-size: 14px; color: #334155;">${escapeHtml(comment.text || '')}</div>
      <div class="timestamp" style="margin-top: 6px;">${createdAt.toLocaleString()} ${deleteBtn}</div>
    </div>
  `;
}

window.deleteComment = async function(postId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    const postRef = doc(db, 'forum', postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) return;
    const postData = postSnap.data();
    const updatedComments = (postData.comments || []).filter(c => c.id !== commentId);
    await updateDoc(postRef, { comments: updatedComments });
    showNotification('Comment deleted.', 'info');
  } catch (error) {
    console.error('Failed to delete comment:', error);
    showNotification('Could not delete comment.', 'error');
  }
};

function createForumPostElement(text, authorName = 'Unknown', role = '', createdAt = new Date(), postId = null, authorId = null, reactions = {}, comments = [], reactedBy = []) {
  const post = document.createElement('div');
  post.className = 'post';
  post.style.borderLeftColor = role === 'instructor' ? '#22863a' : '#0066cc';

  const timestampValue = createdAt?.toDate ? createdAt.toDate().toLocaleString() : new Date(createdAt).toLocaleString();
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const userId = currentUser.uid || currentUser.id || '';
  const existingReaction = Array.isArray(reactedBy) ? reactedBy.find(item => item.userId === userId) : null;
  const currentReactionType = existingReaction?.reactionType || null;
  const canDelete = userId && (currentUser.uid === authorId || currentUser.id === authorId || currentUser.role === 'admin');
  const safeReactions = {
    like: reactions?.like || 0,
    love: reactions?.love || 0,
    wow: reactions?.wow || 0
  };
  const commentCount = Array.isArray(comments) ? comments.length : 0;
  const likeClass = currentReactionType === 'like' ? ' active' : '';
  const loveClass = currentReactionType === 'love' ? ' active' : '';
  const wowClass = currentReactionType === 'wow' ? ' active' : '';

  post.innerHTML = `
    <strong>${escapeHtml(authorName)} (${escapeHtml(role)})</strong>
    <div style="margin-top: 8px; color: #555; font-size: 14px;">${escapeHtml(text)}</div>
    <div class="summary-line">
      <span>${commentCount} comment${commentCount === 1 ? '' : 's'}</span>
      <span>${safeReactions.like + safeReactions.love + safeReactions.wow} reactions</span>
    </div>
    <div class="reaction-bar">
      <button class="reaction-button${likeClass}" data-reaction="like">${getReactionLabel('like')} · ${safeReactions.like}</button>
      <button class="reaction-button${loveClass}" data-reaction="love">${getReactionLabel('love')} · ${safeReactions.love}</button>
      <button class="reaction-button${wowClass}" data-reaction="wow">${getReactionLabel('wow')} · ${safeReactions.wow}</button>
    </div>
    <div class="comment-section">
      <div class="comment-list">
        ${commentCount > 0 ? comments.map(comment => formatCommentText(comment, postId)).join('') : '<p style="color:#64748b; font-size:13px;">No comments yet. Be the first to reply.</p>'}
      </div>
      <div class="comment-input-group">
        <input type="text" class="comment-input" placeholder="Write a comment..." aria-label="Write a comment" />
        <button class="primary comment-submit" type="button">Reply</button>
      </div>
    </div>
    <div class="timestamp">${timestampValue}</div>
    ${canDelete && postId ? '<button class="delete-post" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:12px;margin-top:8px;">Delete</button>' : ''}
  `;

  const reactionButtons = post.querySelectorAll('.reaction-button');
  reactionButtons.forEach(button => {
    button.addEventListener('click', () => {
      const reactionType = button.dataset.reaction;
      reactToPost(postId, reactionType);
    });
  });

  const commentSubmit = post.querySelector('.comment-submit');
  const commentInput = post.querySelector('.comment-input');
  if (commentSubmit && commentInput) {
    commentSubmit.addEventListener('click', () => {
      const commentText = commentInput.value.trim();
      if (!commentText) {
        showNotification('Please type a comment first.', 'warning');
        return;
      }
      addCommentToPost(postId, commentText);
    });
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commentSubmit.click();
      }
    });
  }

  if (canDelete && postId) {
    const deleteBtn = post.querySelector('.delete-post');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this forum post?')) return;
      try {
        await deleteDoc(doc(db, 'forum', postId));
        post.remove();
        showNotification('Discussion deleted.', 'info');
      } catch (error) {
        console.error('Failed to delete forum post:', error);
        showNotification('Could not delete forum post.', 'error');
      }
    });
  }

  return post;
}

// Add note functionality (for personal notes only, not instructor announcements)
function addPost() {
  const input = document.getElementById('postInput');
  const text = input.value.trim();
  
  if (text === '') {
    showNotification('Please write a note first! ✍️', 'warning');
    return;
  }

  if (text.length > 500) {
    showNotification('Note is too long! (Max 500 characters)', 'warning');
    return;
  }

  const note = createNoteElement(text);
  document.getElementById('posts').appendChild(note);
  
  input.value = '';
  input.focus();
  
  // Save notes to localStorage
  saveNotesToStorage();
  
  showNotification('Note saved successfully! 📝', 'success');
}

// Create note element
function createNoteElement(text) {
  const note = document.createElement('div');
  note.className = 'post';
  note.style.borderLeftColor = '#0066cc';
  const timestamp = new Date().toLocaleString();
  note.innerHTML = `
    <strong>📝 My Note</strong>
    <div style="margin-top: 8px; color: #555; font-size: 14px;">${escapeHtml(text)}</div>
    <div class="timestamp">${timestamp}</div>
    <button class="delete-post" style="background: none; border: none; color: #999; cursor: pointer; font-size: 12px; margin-top: 8px;">Delete</button>
  `;
  
  // Add delete functionality with confirmation
  const deleteBtn = note.querySelector('.delete-post');
  deleteBtn.addEventListener('click', () => {
    if (!confirm('Are you sure you want to delete this note?')) {
      return;
    }
    note.remove();
    saveNotesToStorage();
    showNotification('Note deleted', 'info');
  });
  
  return note;
}

// Save notes to localStorage
function saveNotesToStorage() {
  const postsContainer = document.getElementById('posts');
  const notes = [];
  
  postsContainer.querySelectorAll('.post').forEach((post) => {
    const strongText = post.querySelector('strong').textContent;
    
    // Skip if it's an instructor announcement
    if (!strongText.includes('📝')) {
      return;
    }
    
    const textDiv = post.querySelector('[style*="color: #555"]');
    
    notes.push({
      text: textDiv ? textDiv.textContent : '',
      timestamp: post.querySelector('.timestamp')?.textContent || ''
    });
  });
  
  localStorage.setItem('studentNotes', JSON.stringify(notes));
}

// Load notes from localStorage
function loadNotesFromStorage() {
  const savedNotes = localStorage.getItem('studentNotes');
  if (!savedNotes) return;
  
  const postsContainer = document.getElementById('posts');
  if (!postsContainer) return;
  
  const notes = JSON.parse(savedNotes);
  notes.forEach(noteData => {
    const note = createNoteElement(noteData.text);
    postsContainer.appendChild(note);
  });
}

// Setup event listeners
function setupEventListeners() {
  const postInput = document.getElementById('postInput');
  if (postInput) {
    const charCount = document.createElement('div');
    charCount.className = 'character-count';
    charCount.style.marginTop = '8px';
    postInput.parentNode.insertBefore(charCount, postInput.nextSibling);
    
    postInput.addEventListener('input', function() {
      charCount.textContent = `${this.value.length}/500 characters`;
    });
    
    // Allow posting with Enter key
    postInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.ctrlKey) {
        addPost();
      }
    });
  }
  
  const forumInput = document.getElementById('forumInput');
  const forumCharCount = document.getElementById('forumCharCount');
  if (forumInput && forumCharCount) {
    forumInput.addEventListener('input', function() {
      forumCharCount.textContent = `${this.value.length} / 500`;
    });
  }

  // Restore last viewed section
  const lastSection = getStoredSection();
  if (document.getElementById(lastSection)) {
    showSection(lastSection);
  }
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  const safeText = String(text);
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return safeText.replace(/[&<>"']/g, m => map[m]);
}

// Export data function
function exportData() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const data = {
    student: currentUser.name || 'Student',
    studentId: currentUser.uid || 'N/A',
    exportDate: new Date().toLocaleString(),
    notes: JSON.parse(localStorage.getItem('studentNotes') || '[]')
  };
  
  const dataStr = JSON.stringify(data, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${currentUser.name || 'clinical'}-notes-${Date.now()}.json`;
  link.click();
  
  showNotification('Notes exported! 💾', 'success');
}

// Search functionality
function searchPosts(query) {
  const posts = document.querySelectorAll('.post');
  const lowerQuery = query.toLowerCase();
  
  posts.forEach(post => {
    const text = post.textContent.toLowerCase();
    post.style.display = text.includes(lowerQuery) ? 'block' : 'none';
  });
}

// Dark mode toggle
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

// Print schedule
function printSchedule() {
  window.print();
  showNotification('Opening print dialog...', 'info');
}

// Clear all personal notes
function clearAllData() {
  if (confirm('Are you sure you want to clear all your personal notes? This cannot be undone! (Instructor announcements will remain)')) {
    localStorage.removeItem('studentNotes');
    const postsContainer = document.getElementById('posts');
    
    // Keep only instructor announcements
    const announcements = postsContainer.querySelectorAll('.post');
    announcements.forEach(post => {
      const strongText = post.querySelector('strong').textContent;
      if (strongText.includes('📝')) {
        post.remove();
      }
    });
    
    showNotification('All personal notes cleared!', 'info');
  }
}

// Load page with preserved state
window.addEventListener('load', function() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark-mode');
  }
});

/******* DUTY REQUIREMENT FEATURE *******/

// File type to emoji mapping
const fileTypeEmojis = {
  'Learning Feedback Diary': '📖',
  'Drug Study': '💊',
  'Nursing Care Plan': '🏥'
};

// Get file extension icon
function getFileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const icons = {
    'pdf': '📄',
    'doc': '📝',
    'docx': '📝',
    'jpg': '🖼️',
    'jpeg': '🖼️',
    'png': '🖼️'
  };
  return icons[ext] || '📎';
}

// Upload duty file
async function uploadDutyFile(fileType) {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  if (!currentUser.uid) {
    showNotification('Please log in first!', 'warning');
    return;
  }

  const fileInputId = fileType.toLowerCase().replace(/ /g, '') + 'File';
  const fileInput = document.getElementById(fileInputId);
  
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showNotification('Please select a file first!', 'warning');
    return;
  }

  const file = fileInput.files[0];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (file.size > maxSize) {
    showNotification('File size exceeds 10MB limit!', 'warning');
    return;
  }

  // Create file metadata
  const fileData = {
    fileName: file.name,
    fileSize: file.size,
    fileType: fileType,
    studentId: currentUser.uid,
    studentName: currentUser.name || 'Student',
    studentEmail: currentUser.email || '',
    uploadDate: new Date().toISOString(),
    submitted: false,
    fileContent: null // In production, store in Firebase Storage or Cloud Firestore
  };

  // For now, store file data in localStorage (in production, use Firebase Storage)
  const dutyData = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const fileId = 'file_' + Date.now();
  fileData.id = fileId;

  // Store base64 encoded file content
  const reader = new FileReader();
  reader.onload = async function(e) {
    fileData.fileContent = e.target.result;

    dutyData.push(fileData);
    localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyData));

    // Try to store in Firestore
    try {
      await addDoc(collection(db, 'dutyRequirements'), {
        ...fileData,
        fileContent: null // Don't store actual file content in Firestore
      });
    } catch (err) {
      console.warn('Could not sync with Firestore:', err);
    }

    fileInput.value = '';
    await loadStudentDutyFiles();
    showNotification(`${fileType} uploaded successfully! ✅`, 'success');
  };

  reader.readAsDataURL(file);
}
window.uploadDutyFile = uploadDutyFile;

// Handle file input change
function setupDutyFileInput() {
  const fileInput = document.getElementById('dutyFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      const fileName = this.files[0]?.name || 'Choose file...';
      document.getElementById('dutyFileName').textContent = '✓ ' + fileName;
    });
  }
}

async function submitDutyFile(fileId) {
  if (!confirm('Submit this file to instructor for review?')) return;
  const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const target = dutyFiles.find(f => f.id === fileId);
  if (!target) {
    showNotification('File not found.', 'warning');
    return;
  }
  target.submitted = true;
  target.submittedDate = new Date().toISOString();
  localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyFiles));

  if (target.firestoreId) {
    try {
      await updateDoc(doc(db, 'dutyRequirements', target.firestoreId), {
        submitted: true,
        submittedDate: target.submittedDate
      });
      showNotification('File submitted and Firestore updated.', 'success');
    } catch (err) {
      console.error('Failed to update submission status in Firestore:', err);
      showNotification('Submitted locally but Firestore update failed.', 'warning');
    }
  } else {
    try {
      const docRef = await addDoc(collection(db, 'dutyRequirements'), target);
      target.firestoreId = docRef.id;
      localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyFiles));
      showNotification('File submitted and saved to Firestore.', 'success');
    } catch (err) {
      console.error('Failed to add submitted file to Firestore:', err);
      showNotification('Submitted locally but Firestore save failed.', 'warning');
    }
  }

  await loadStudentDutyFiles();
}
window.submitDutyFile = submitDutyFile;

// Load instructor duty view
async function loadInstructorDutyView() {
  const container = document.getElementById('instructorDutyFolders') || document.getElementById('instructorStudentFolders');
  
  if (!container) return;

  try {
    const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
    
    // Only show files that have been submitted by the student
    const submittedFiles = dutyFiles.filter(file => file.submitted);

    // Group files by student
    const studentFolders = {};
    submittedFiles.forEach(file => {
      if (!studentFolders[file.studentId]) {
        studentFolders[file.studentId] = {
          studentName: file.studentName,
          studentEmail: file.studentEmail,
          studentId: file.studentId,
          files: []
        };
      }
      studentFolders[file.studentId].files.push(file);
    });

    if (Object.keys(studentFolders).length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px; grid-column: 1/-1;">No submissions yet.</p>';
      return;
    }

    container.innerHTML = '';

    Object.values(studentFolders).forEach(folder => {
      const card = document.createElement('div');
      card.className = 'student-folder-card';
      
      const reviewedCount = folder.files.filter(f => f.reviewed).length;
      const totalCount = folder.files.length;

      card.innerHTML = `
        <div class="folder-header">
          <div class="folder-header-icon">📁</div>
          <div class="folder-header-info">
            <h4>${escapeHtml(folder.studentName)}</h4>
            <p>${totalCount} file(s)</p>
          </div>
        </div>
        <div class="folder-content">
          ${folder.files.length === 0 ? '<div class="folder-content-empty">No files uploaded</div>' : ''}
        </div>
      `;

      // Add files to folder
      const folderContent = card.querySelector('.folder-content');
      if (folder.files.length > 0) {
        folderContent.innerHTML = '';
        folder.files.forEach(file => {
          const fileItem = document.createElement('div');
          fileItem.className = 'file-item';
          
          const uploadDate = new Date(file.uploadDate).toLocaleDateString();
          const reviewedBadge = file.reviewed ? `<span class="reviewed-badge">✅ Reviewed</span>` : '';

          fileItem.innerHTML = `
            <div class="file-icon">${getFileIcon(file.fileName)}</div>
            <div class="file-info">
              <div class="file-name">
                ${escapeHtml(file.fileName)}
                ${file.fileType ? `<span class="file-type-badge" style="margin-left: 8px;">${fileTypeEmojis[file.fileType]} ${file.fileType}</span>` : ''}
              </div>
              <div class="file-meta">
                <span>${uploadDate}</span>
                <span>📊 ${(file.fileSize / 1024).toFixed(2)} KB</span>
              </div>
            </div>
            <div class="file-actions">
              <button onclick="downloadDutyFile('${file.id}')">⬇️</button>
            </div>
          `;
          
          folderContent.appendChild(fileItem);
        });
      }

      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'download-btn';
      downloadBtn.textContent = '⬇️ Download All Files';
      downloadBtn.onclick = () => downloadAllStudentFiles(folder.studentId, folder.studentName);
      card.querySelector('.folder-content').appendChild(downloadBtn);

      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading instructor duty view:', error);
  }
}
window.loadInstructorDutyView = loadInstructorDutyView;

// Download all student files as individual files
function downloadAllStudentFiles(studentId, studentName) {
  const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const studentFiles = dutyFiles.filter(f => f.studentId === studentId);
  
  if (studentFiles.length === 0) {
    showNotification('No files to download!', 'warning');
    return;
  }

  studentFiles.forEach((file, index) => {
    setTimeout(() => {
      if (file.fileContent) {
        const link = document.createElement('a');
        link.href = file.fileContent;
        link.download = file.fileName;
        link.click();
      }
    }, index * 500); // Stagger downloads
  });

  showNotification(`Downloading ${studentFiles.length} file(s) from ${escapeHtml(studentName)}...`, 'success');
}
window.downloadAllStudentFiles = downloadAllStudentFiles;

// Search and filter functionality for instructor
function setupDutyRequirementFilters() {
  const searchInput = document.getElementById('dutySearchStudent');
  const filterType = document.getElementById('dutyFilterType');
  
  if (searchInput && filterType) {
    searchInput.addEventListener('input', applyDutyFilters);
    filterType.addEventListener('change', applyDutyFilters);
  }
}

function applyDutyFilters() {
  const searchInput = document.getElementById('dutySearchStudent');
  const filterType = document.getElementById('dutyFilterType');
  const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  
  if (!searchInput || !filterType) return;

  const searchTerm = searchInput.value.toLowerCase();
  const filterValue = filterType.value;

  let filteredFiles = dutyFiles;
  
  if (searchTerm) {
    filteredFiles = filteredFiles.filter(f => 
      f.studentName.toLowerCase().includes(searchTerm) || 
      f.fileName.toLowerCase().includes(searchTerm)
    );
  }

  if (filterValue) {
    filteredFiles = filteredFiles.filter(f => f.fileType === filterValue);
  }

  // Update view with filtered files
  const studentFolders = {};
  filteredFiles.forEach(file => {
    if (!studentFolders[file.studentId]) {
      studentFolders[file.studentId] = {
        studentName: file.studentName,
        studentEmail: file.studentEmail,
        studentId: file.studentId,
        files: []
      };
    }
    studentFolders[file.studentId].files.push(file);
  });

  const container = document.getElementById('instructorStudentFolders');
  if (!container) return;

  if (Object.keys(studentFolders).length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px; grid-column: 1/-1;">No matching submissions found.</p>';
    return;
  }

  container.innerHTML = '';

  Object.values(studentFolders).forEach(folder => {
    const card = document.createElement('div');
    card.className = 'student-folder-card';
    
    const reviewedCount = folder.files.filter(f => f.reviewed).length;
    const totalCount = folder.files.length;

    card.innerHTML = `
      <div class="folder-header">
        <div class="folder-header-icon">📁</div>
        <div class="folder-header-info">
          <h4>${escapeHtml(folder.studentName)}</h4>
          <p>${totalCount} file(s) • ${reviewedCount} reviewed</p>
        </div>
      </div>
      <div class="folder-content">
      </div>
    `;

    const folderContent = card.querySelector('.folder-content');
    folder.files.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'file-item';
      
      const uploadDate = new Date(file.uploadDate).toLocaleDateString();

      fileItem.innerHTML = `
        <div class="file-icon">${getFileIcon(file.fileName)}</div>
        <div class="file-info">
          <div class="file-name">
            ${escapeHtml(file.fileName)}
            <span class="file-type-badge" style="margin-left: 8px;">${fileTypeEmojis[file.fileType]} ${file.fileType}</span>
          </div>
          <div class="file-meta">
            <span>${uploadDate}</span>
            <span>📊 ${(file.fileSize / 1024).toFixed(2)} KB</span>
          </div>
        </div>
        <div class="file-actions">
          <button onclick="downloadDutyFile('${file.id}')">⬇️</button>
        </div>
      `;
      
      folderContent.appendChild(fileItem);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'download-btn';
    downloadBtn.textContent = '⬇️ Download All Files';
    downloadBtn.onclick = () => downloadAllStudentFiles(folder.studentId, folder.studentName);
    folderContent.appendChild(downloadBtn);

    container.appendChild(card);
  });
}
window.applyDutyFilters = applyDutyFilters;

// Initialize duty requirement feature
async function initializeDutyRequirement() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const studentView = document.getElementById('studentDutyView');
  const instructorView = document.getElementById('instructorDutyView');
  
  if (!studentView || !instructorView) return;

  // Hook submit button once during initialization
  const submitDutyLinkBtn = document.getElementById('submitDutyLinkBtn');
  if (submitDutyLinkBtn) {
    submitDutyLinkBtn.removeEventListener('click', submitDutyLink);
    submitDutyLinkBtn.addEventListener('click', submitDutyLink);
  }

  setupDutyFileInput();

  if (currentUser.role === 'student') {
    studentView.style.display = 'block';
    instructorView.style.display = 'none';
    populateDutySectionSelect();
    await loadStudentDutyFiles();
  } else if (currentUser.role === 'instructor') {
    studentView.style.display = 'none';
    instructorView.style.display = 'block';
    loadInstructorDutyView();
    setupDutyRequirementFilters();
  }
}
window.initializeDutyRequirement = initializeDutyRequirement;

function getStudentSectionById(sectionId) {
  const sections = getStudentSections();
  return sections.find(section => section.id === sectionId || section.firestoreId === sectionId);
}

async function loadStudentDutyFiles(sectionId = null, containerId = 'studentFilesList') {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const container = document.getElementById(containerId);
  if (!container) return;

  const localDutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const remoteDutyFiles = [];
  const identifiers = Array.from(new Set([
    currentUser.uid,
    currentUser.id,
    currentUser.studentId,
    currentUser.email
  ].filter(Boolean)));

  try {
    for (const field of ['studentUid', 'studentId']) {
      for (const identifier of identifiers) {
        const snapshot = await getDocs(query(collection(db, 'dutyRequirements'), where(field, '==', identifier)));
        snapshot.forEach(docSnap => {
          remoteDutyFiles.push({ firestoreId: docSnap.id, ...docSnap.data() });
        });
      }
    }
  } catch (err) {
    console.error('Failed to fetch duty requirement files from Firestore:', err);
  }

  const mergedFiles = new Map();
  [...localDutyFiles, ...remoteDutyFiles].forEach(file => {
    const key = file.firestoreId || file.id || `${file.studentUid || file.studentId || file.studentEmail || 'unknown'}-${file.sectionId || ''}-${file.fileType || ''}-${file.uploadDate || ''}`;
    if (!mergedFiles.has(key)) {
      mergedFiles.set(key, file);
    }
  });

  const studentFiles = Array.from(mergedFiles.values()).filter(file => {
    const ownerId = file.studentUid || file.studentId || file.studentEmail || '';
    const isMine = identifiers.includes(ownerId) || ownerId === currentUser.email;
    const inSection = !sectionId || file.sectionId === sectionId;
    return isMine && inSection;
  }).sort((a, b) => new Date(b.uploadDate || 0) - new Date(a.uploadDate || 0));

  if (studentFiles.length === 0) {
    container.innerHTML = `<p style="text-align: center; color: #999; padding: 20px;">${sectionId ? 'No submissions yet for this classroom.' : 'No duty requirement submissions yet.'}</p>`;
    return;
  }

  container.innerHTML = studentFiles.map(file => {
    const fileId = file.firestoreId || file.id || '';
    const uploadDate = file.uploadDate ? new Date(file.uploadDate).toLocaleDateString() : 'Unknown date';
    const isLink = typeof file.fileContent === 'string' && /^(https?:\/\/)/i.test(file.fileContent);
    const actionMarkup = isLink
      ? `<a href="${escapeHtml(file.fileContent)}" target="_blank" rel="noopener noreferrer" class="open" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;">Open</a>`
      : `<button onclick="downloadDutyFile('${fileId}')">Download</button>`;

    return `
      <div class="file-item" style="margin-bottom: 12px;">
        <div class="file-icon">${isLink ? '🔗' : getFileIcon(file.fileName || file.fileType || 'Submission')}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(file.fileType || 'Submission')}<span style="color: #0f9d58; font-weight: 600; margin-left: 8px;">Submitted</span></div>
          <div class="file-meta">
            <span>${uploadDate}</span>
          </div>
        </div>
        <div class="file-actions">
          ${actionMarkup}
          <button class="delete" onclick="deleteDutyFile('${fileId}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}
window.loadStudentDutyFiles = loadStudentDutyFiles;

async function submitDutyLink(sectionIdOverride = null) {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const sectionId = sectionIdOverride || document.getElementById('dutySectionSelect')?.value || '';
  const type = document.getElementById('classroomDutyType')?.value || document.getElementById('dutyLinkType')?.value || '';
  const rawLink = document.getElementById('classroomDutyLink')?.value.trim() || document.getElementById('dutyLinkUrl')?.value.trim() || '';
  const section = getStudentSectionById(sectionId);

  if (!sectionId || !section) {
    showNotification('Please choose a classroom first.', 'warning');
    return;
  }

  if (!type || !rawLink) {
    showNotification('Please select a requirement type and paste a document link.', 'warning');
    return;
  }

  let normalizedLink = rawLink;
  try {
    normalizedLink = new URL(rawLink).toString();
  } catch (error) {
    showNotification('Please enter a valid link.', 'warning');
    return;
  }

  const newItem = {
    id: 'duty_' + Date.now(),
    fileName: `${type} Link`,
    fileSize: 0,
    fileType: type,
    fileContent: normalizedLink,
    fileMimeType: 'text/uri-list',
    sectionId,
    sectionName: section.name || '',
    sectionCode: section.code || '',
    studentId: currentUser.uid || currentUser.studentId || currentUser.id || 'Unknown',
    studentUid: currentUser.uid || currentUser.id || '',
    studentName: currentUser.name || 'Student',
    studentEmail: currentUser.email || '',
    instructorId: section.instructorId || '',
    instructor: section.instructorName || 'Instructor',
    uploadDate: new Date().toISOString(),
    submitted: true
  };

  const dutyData = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  dutyData.push(newItem);
  localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyData));

  try {
    const docRef = await addDoc(collection(db, 'dutyRequirements'), newItem);
    newItem.firestoreId = docRef.id;
    const index = dutyData.findIndex(item => item.id === newItem.id);
    if (index !== -1) {
      dutyData[index].firestoreId = docRef.id;
      localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyData));
    }
  } catch (err) {
    console.error('Failed to save duty requirement link to Firestore:', err);
    showNotification('Saved locally, but Firestore sync failed. It will sync when connection is stable.', 'warning');
  }

  const classroomType = document.getElementById('classroomDutyType');
  const classroomLink = document.getElementById('classroomDutyLink');
  if (classroomType) classroomType.value = '';
  if (classroomLink) classroomLink.value = '';

  const legacyType = document.getElementById('dutyLinkType');
  const legacyLink = document.getElementById('dutyLinkUrl');
  if (legacyType) legacyType.value = '';
  if (legacyLink) legacyLink.value = '';

  await loadStudentDutyFiles();
  await loadStudentDutyFiles(sectionId, 'studentSectionFilesList');
  showNotification('Duty requirement link submitted successfully.', 'success');
}
window.submitDutyLink = submitDutyLink;

async function deleteDutyFile(fileId) {
  if (!confirm('Are you sure you want to delete this submission?')) {
    return;
  }

  let dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const target = dutyFiles.find(file => file.id === fileId || file.firestoreId === fileId);

  if (target?.firestoreId) {
    try {
      await deleteDoc(doc(db, 'dutyRequirements', target.firestoreId));
    } catch (err) {
      console.warn('Failed to delete duty requirement from Firestore:', err);
    }
  }

  dutyFiles = dutyFiles.filter(file => file.id !== fileId && file.firestoreId !== fileId);
  localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyFiles));

  await loadStudentDutyFiles();
  if (target?.sectionId) {
    await loadStudentDutyFiles(target.sectionId, 'studentSectionFilesList');
  }

  showNotification('Duty requirement submission deleted.', 'info');
}
window.deleteDutyFile = deleteDutyFile;

function downloadDutyFile(fileId) {
  const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const file = dutyFiles.find(f => f.id === fileId);
  
  if (!file) {
    showNotification('File not found!', 'warning');
    return;
  }

  const downloadUrl = file.downloadUrl || file.fileContent;
  if (downloadUrl) {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = file.fileName;
    link.click();
    showNotification('Downloading...', 'info');
  } else {
    showNotification('File data not available for download!', 'warning');
  }
}
window.downloadDutyFile = downloadDutyFile;
