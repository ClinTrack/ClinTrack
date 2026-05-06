import { db, auth } from './firebase.js';
import { collection, addDoc, getDocs, getDoc, serverTimestamp, deleteDoc, doc, updateDoc, query, where, orderBy, arrayUnion, increment, runTransaction, onSnapshot } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { setupPortalMenu } from './portal-menu.js';

const SECTION_STORAGE_KEY = 'instructorCurrentSection';

// Forum real-time listener
let forumListener = null;

// Modal state management
let currentModalSection = null;
let currentModalCategory = 'Learning Feedback Diary';

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

// Instructor Portal Script
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

function displayInstructorName() {
  const currentUser = localStorage.getItem('currentUser');
  if (currentUser) {
    const user = JSON.parse(currentUser);
    const profileNameElement = document.getElementById('profileName');
    if (profileNameElement) {
      profileNameElement.textContent = user.name;
    }
  }
}

// Classroom management entry point
async function loadDutyRequirementSections() {
  await loadInstructorDutyView();
}

async function loadEnrolledStudents(sectionId) {
  const container = document.getElementById('enrolledStudentsContainer');
  const noSectionContainer = document.getElementById('noSectionContainer');
  const studentListDisplay = document.getElementById('studentListDisplay');
  const submissionsContainer = document.getElementById('submissionsContainer');
  const sectionCodeValue = document.getElementById('sectionCodeValue');
  const sectionCodeDisplay = document.getElementById('sectionCodeDisplay');

  container.style.display = 'block';
  noSectionContainer.style.display = 'none';

  let students = [];
  let sectionData = {};

  // Fetch latest section data from Firestore
  try {
    const sectionRef = doc(db, 'sections', sectionId);
    const sectionDoc = await getDoc(sectionRef);
    
    if (sectionDoc.exists()) {
      sectionData = sectionDoc.data();
      students = sectionData.students || [];
    }
  } catch (error) {
    console.error('Error loading section students from Firestore:', error);
  }

  // Display section code - reset UI and add fresh copy functionality
  if (sectionData.code) {
    sectionCodeValue.textContent = sectionData.code;
    
    // Remove old click listeners by cloning and replacing
    const newCodeDisplay = sectionCodeDisplay.cloneNode(true);
    sectionCodeDisplay.parentNode.replaceChild(newCodeDisplay, sectionCodeDisplay);
    
    // Add click listener to copied code element
    newCodeDisplay.addEventListener('click', function() {
      navigator.clipboard.writeText(sectionData.code).then(() => {
        newCodeDisplay.style.backgroundColor = '#d4edda';
        newCodeDisplay.style.borderColor = '#28a745';
        newCodeDisplay.innerHTML = '<span style="font-weight: 600; color: #059669;">✓ Copied!</span>';
        
        setTimeout(() => {
          newCodeDisplay.style.backgroundColor = '#f0f7ff';
          newCodeDisplay.style.borderColor = '#0066cc';
          newCodeDisplay.innerHTML = '<span style="font-weight: 600; color: #0066cc;">Code: </span><span style="font-weight: 700; color: #004aa0;">' + sectionData.code + '</span>';
        }, 1500);
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    });
  }

  if (!students || students.length === 0) {
    studentListDisplay.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999; padding: 20px;">No students enrolled in this section yet.</p>';
    submissionsContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No students enrolled.</p>';
    return;
  }

  studentListDisplay.innerHTML = students.map(student => `
    <div class="student-submission-card">
      <h5>👤 ${student.name || student.studentName || 'Unknown'}</h5>
      <p>${student.email || student.studentEmail || 'No email'}</p>
    </div>
  `).join('');

  submissionsContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Select a category to view submissions.</p>';

  // Set current section for submissions
  window.currentDutySection = { id: sectionId, students, data: sectionData };
}

function displayStudentSubmissions(category) {
  const sectionData = window.currentDutySection;
  if (!sectionData) return;

  const submissionsContainer = document.getElementById('submissionsContainer');
  const students = sectionData.students || [];

  if (category === 'all') {
    const allSubmissions = [];
    students.forEach(student => {
      const studentSubmissions = (student.dutyRequirements || []);
      studentSubmissions.forEach(sub => {
        allSubmissions.push({ ...sub, studentName: student.name || student.studentName });
      });
    });

    if (allSubmissions.length === 0) {
      submissionsContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No submissions yet.</p>';
      return;
    }

    submissionsContainer.innerHTML = allSubmissions.map(sub => `
      <div class="submission-item">
        <div class="submission-info">
          <h5>${sub.studentName}</h5>
          <p><strong>${sub.type || 'Unknown'}</strong> • Submitted: ${new Date(sub.submittedAt).toLocaleDateString()}</p>
          <p>${sub.link || 'No link provided'}</p>
        </div>
        <a href="${sub.link}" target="_blank" style="padding: 8px 16px; background: #0066cc; color: white; border-radius: 6px; text-decoration: none; font-weight: 600;">View</a>
      </div>
    `).join('');
  } else {
    const categorySubmissions = [];
    students.forEach(student => {
      const studentSubmissions = (student.dutyRequirements || []).filter(s => s.type === category);
      studentSubmissions.forEach(sub => {
        categorySubmissions.push({ ...sub, studentName: student.name || student.studentName });
      });
    });

    if (categorySubmissions.length === 0) {
      submissionsContainer.innerHTML = `<p style="text-align: center; color: #999; padding: 20px;">No ${category} submissions yet.</p>`;
      return;
    }

    submissionsContainer.innerHTML = categorySubmissions.map(sub => `
      <div class="submission-item">
        <div class="submission-info">
          <h5>${sub.studentName}</h5>
          <p>Submitted: ${new Date(sub.submittedAt).toLocaleDateString()}</p>
          <p>${sub.link || 'No link provided'}</p>
        </div>
        <a href="${sub.link}" target="_blank" style="padding: 8px 16px; background: #0066cc; color: white; border-radius: 6px; text-decoration: none; font-weight: 600;">View</a>
      </div>
    `).join('');
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  setupPortalMenu();
  displayInstructorName();
  await loadInstructorSchedule();
  loadAnnouncements();
  setupInstructorEventListeners();
  setupCategoryFilters();
  processPendingCalls();
  showNotification('Welcome, Instructor! 👋', 'info');
});

function setupCategoryFilters() {
  const categoryBtns = document.querySelectorAll('.category-btn');
  categoryBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.dataset.category;
      displayStudentSubmissions(category);
    });
  });
}

async function loadInstructorSchedule() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const currentInstructorId = currentUser.id || currentUser.uid || '';

  const adminData = getAdminData();
  const localSchedules = (adminData.schedules || []).filter(s => s.instructorUid === currentInstructorId || s.instructor === currentUser.name);
  const localLabs = (adminData.labs || []).filter(l => l.instructorId === currentInstructorId || l.instructor === currentUser.name);

  let firestoreSchedules = [];
  let firestoreLabs = [];
  let firestoreSections = [];
  try {
    const scheduleSnapshot = await getDocs(collection(db, 'schedules'));
    scheduleSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (!data) return;
      if (data.instructorUid === currentInstructorId || data.instructorId === currentInstructorId || data.instructor === currentUser.name) {
        firestoreSchedules.push({ id: docSnap.id, ...data });
      }
    });

    const labSnapshot = await getDocs(collection(db, 'labs'));
    labSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (!data) return;
      if (data.instructorId === currentInstructorId || data.instructor === currentUser.name) {
        firestoreLabs.push({ id: docSnap.id, ...data });
      }
    });

    // Load instructor-created sections from Firestore
    const sectionSnapshot = await getDocs(query(collection(db, 'sections'), where('instructorId', '==', currentInstructorId)));
    sectionSnapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (!data) return;
      firestoreSections.push({ id: docSnap.id, ...data });
    });
  } catch (error) {
    console.error('Error loading Firestore instructor data:', error);
  }

  const dedupeByKey = (items) => {
    const map = new Map();
    items.forEach(item => {
      const key = item.firestoreId || item.id || `${item.studentId || item.studentUid || ''}-${item.date || ''}-${item.shift || ''}-${item.instructorId || item.instructorUid || ''}`;
      if (!map.has(key)) {
        map.set(key, item);
      }
    });
    return [...map.values()];
  };

  const scheduleList = dedupeByKey([...localSchedules, ...firestoreSchedules]);
  const labList = dedupeByKey([...localLabs, ...firestoreLabs]);

  renderScheduleTable(scheduleList);
  renderLabTable(labList);
  const sections = await loadInstructorSections();
  updateInstructorStats(scheduleList, labList, sections);
  setupScheduleFormListeners();
}

function getAdminData() {
  return JSON.parse(localStorage.getItem('nursingHubAdminData') || '{}');
}

function saveAdminData(data) {
  localStorage.setItem('nursingHubAdminData', JSON.stringify(data));
}

function generateSectionCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getInstructorSections() {
  const adminData = getAdminData();
  const sections = adminData.sections || [];
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const instructorId = currentUser.id || currentUser.uid || '';
  return sections.filter(s => s.instructorId === instructorId);
}

function saveInstructorSection(section) {
  const adminData = getAdminData();
  adminData.sections = adminData.sections || [];
  adminData.sections.push(section);
  saveAdminData(adminData);
}

async function loadInstructorSections() {
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const instructorId = currentUser.id || currentUser.uid || '';

  // local fallback first
  let sections = getInstructorSections();

  try {
    const querySnapshot = await getDocs(query(collection(db, 'sections'), where('instructorId', '==', instructorId)));
    const firestoreSections = [];
    querySnapshot.forEach(docSnap => {
      const sec = docSnap.data();
      if (!sec) return;
      firestoreSections.push({ id: docSnap.id, firestoreId: docSnap.id, ...sec });
    });

    const map = new Map();
    [...sections, ...firestoreSections].forEach(sec => {
      const key = sec.firestoreId || sec.id || sec.code;
      map.set(key, sec);
    });

    sections = [...map.values()];

    const adminData = getAdminData();
    adminData.sections = sections;
    saveAdminData(adminData);
  } catch (error) {
    console.error('Failed loading sections from Firestore:', error);
  }

  renderInstructorSections(sections);
  return sections;
}

function renderInstructorSections(sections) {
  const container = document.getElementById('instructorSectionsContainer');
  if (!container) return;

  if (!sections || sections.length === 0) {
    container.innerHTML = '<p style="color:#999; padding:12px;">No sections created yet. Create a section to manage students and submissions.</p>';
    return;
  }

  const formatDateSafely = (dateValue) => {
    if (!dateValue) return 'Just now';
    try {
      let date;
      if (dateValue.toDate && typeof dateValue.toDate === 'function') {
        // Firestore Timestamp
        date = dateValue.toDate();
      } else if (typeof dateValue === 'string') {
        date = new Date(dateValue);
      } else if (dateValue instanceof Date) {
        date = dateValue;
      } else {
        return 'Just now';
      }
      
      if (isNaN(date.getTime())) return 'Just now';
      return date.toLocaleDateString();
    } catch (e) {
      return 'Just now';
    }
  };

  const rows = sections.map(section => {
    const studentCount = (section.students || []).length;
    const created = formatDateSafely(section.createdAt);
    const sectionColor = section.color || '#2563eb';
    return `
      <div class="student-folder-card" style="cursor:pointer; max-width:560px; min-height:120px;" onclick="openInstructorSectionModal('${escapeHtml(section.id || section.firestoreId)}')">
        <div class="folder-header" style="background: linear-gradient(135deg, ${sectionColor} 0%, ${sectionColor}dd 100%);">
          <div class="folder-header-icon"><i class="fa-solid fa-folder-closed"></i></div>
          <div class="folder-header-info">
            <h4>${escapeHtml(section.name)}</h4>
            <p>${escapeHtml(section.code)} • ${studentCount} student${studentCount === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div class="folder-content" style="padding:12px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
          <div style="font-size:13px; color:#374151;">Instructor: ${escapeHtml(section.instructorName || 'Instructor')}</div>
          <div style="font-size:13px; color:#4b5563;">Created: ${escapeHtml(created)}</div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = rows;
}

// Store current section detail page state
let currentSectionDetailSection = null;
let currentSectionDetailCategory = 'Learning Feedback Diary';

async function openInstructorClassroom(sectionId) {
  const sections = getInstructorSections();
  const section = sections.find(s => s.id === sectionId || s.firestoreId === sectionId);
  if (!section) {
    showNotification('Section not found', 'error');
    return;
  }
  
  localStorage.setItem('currentInstructorSection', sectionId);
  await navigateToSectionDetail(section, 'Learning Feedback Diary');
}

async function openInstructorSectionModal(sectionId) {
  // Redirect to page-based navigation
  await openInstructorClassroom(sectionId);
}

// Navigate to section detail page
async function navigateToSectionDetail(section, activeCategory = 'Learning Feedback Diary') {
  currentSectionDetailSection = section;
  currentSectionDetailCategory = activeCategory;
  
  const classroomsSection = document.getElementById('classrooms');
  const detailPage = document.getElementById('sectionDetailPage');
  
  if (classroomsSection) classroomsSection.classList.add('hidden');
  if (detailPage) detailPage.classList.remove('hidden');
  
  await renderSectionDetailPage(section, activeCategory);
}

// Go back to classrooms list
window.goBackToClassrooms = function() {
  const classroomsSection = document.getElementById('classrooms');
  const detailPage = document.getElementById('sectionDetailPage');
  
  if (detailPage) detailPage.classList.add('hidden');
  if (classroomsSection) classroomsSection.classList.remove('hidden');
  
  // Reset state
  currentSectionDetailSection = null;
  currentSectionDetailCategory = 'Learning Feedback Diary';
};

// Render section detail page content
async function renderSectionDetailPage(section, activeCategory = 'Learning Feedback Diary') {
  currentSectionDetailSection = section;
  currentSectionDetailCategory = activeCategory;

  const categories = ['Learning Feedback Diary', 'Drug Study', 'Nursing Care Plan'];
  const students = section.students || [];
  const studentCount = students.length;

  // Update header
  const titleEl = document.getElementById('sectionDetailTitle');
  const infoEl = document.getElementById('sectionDetailInfo');
  const headerEl = document.querySelector('.section-detail-header');
  const sectionColor = section.color || '#b91c1c';
  
  if (titleEl) titleEl.textContent = escapeHtml(section.name);
  if (infoEl) infoEl.textContent = `Code: ${escapeHtml(section.code)} • ${studentCount} enrolled student${studentCount === 1 ? '' : 's'}`;
  if (headerEl) {
    headerEl.style.background = sectionColor;
  }

  // Get files and counts
  const files = await getDutyFilesForSection(section.id || section.firestoreId);
  const categoryCounts = categories.reduce((acc, type) => {
    acc[type] = files.filter(file => file.fileType === type).length;
    return acc;
  }, {});

  const selectedFiles = files.filter(file => file.fileType === activeCategory);
  const grouped = selectedFiles.reduce((acc, file) => {
    const key = file.studentId || file.studentUid || file.studentEmail || file.studentName || 'Unknown Student';
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});

  const submissionHtml = selectedFiles.length === 0
    ? '<p style="color:#999; margin-top:12px;">No submissions in this category.</p>'
    : Object.entries(grouped).map(([studentKey, studentFiles]) => {
        const studentName = escapeHtml(studentFiles[0].studentName || studentKey);
        return `
          <div class="student-folder-card" style="padding:12px; margin-bottom:12px;">
            <div class="folder-header" style="background:#f3f4f6; color:#111;">
              <div class="folder-header-info">
                <h4 style="margin:0;">${studentName}</h4>
                <p style="font-size:13px; color:#4b5563;">${studentFiles.length} submission${studentFiles.length === 1 ? '' : 's'}</p>
              </div>
            </div>
            <div class="folder-content" style="padding:10px; gap:10px;">
              ${studentFiles.map(file => {
                const fileId = escapeHtml(file.firestoreId || file.id || '');
                const isLink = typeof file.fileContent === 'string' && /^(https?:\/\/)/i.test(file.fileContent);
                const actionBtn = isLink ? `<button class="open" onclick="openDutyLink('${fileId}')">Open</button>` : `<button class="open" onclick="downloadDutyFile('${fileId}')">Download</button>`;
                const uploadDate = file.uploadDate ? new Date(file.uploadDate).toLocaleDateString() : 'Unknown date';
                return `
                  <div class="file-item" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:10px;">
                    <div class="file-info">
                      <div class="file-name">${escapeHtml(file.fileName || file.fileType || 'Submission')}</div>
                      <div class="file-meta">${uploadDate}</div>
                    </div>
                    <div class="file-actions" style="display:flex; gap:8px; align-items:center;">
                      ${actionBtn}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('');

  // Update category filters
  const categoryFilters = document.getElementById('sectionDetailCategoryFilters');
  if (categoryFilters) {
    categoryFilters.innerHTML = categories.map(type => `
      <button class="category-filter-btn ${activeCategory === type ? 'active' : ''}" data-category="${escapeHtml(type)}" onclick="switchSectionDetailCategory('${escapeHtml(type)}')">
        ${escapeHtml(type)} (${categoryCounts[type]})
      </button>
    `).join('');
  }

  // Update submissions
  const categoryTitle = document.getElementById('sectionDetailCategoryTitle');
  const submissionsContainer = document.getElementById('sectionDetailSubmissions');
  if (categoryTitle) categoryTitle.textContent = escapeHtml(activeCategory);
  if (submissionsContainer) submissionsContainer.innerHTML = submissionHtml;

  // Update students list
  const studentsList = document.getElementById('sectionDetailStudentsList');
  if (studentsList) {
    if (students.length === 0) {
      studentsList.innerHTML = '<p style="color:#999;">No students enrolled yet. Share the section code with students to enroll them.</p>';
    } else {
      studentsList.innerHTML = `<ul>${students.map(s => `<li>${escapeHtml(s.name || s.email || 'Student')}</li>`).join('')}</ul>`;
    }
  }

  // Reset tabs
  const overviewTab = document.getElementById('detailOverviewTab');
  const studentsTab = document.getElementById('detailStudentsTab');
  if (overviewTab) overviewTab.classList.add('active');
  if (studentsTab) studentsTab.classList.remove('active');
}

const renderInstructorClassroomDetail = renderSectionDetailPage;

// Switch between tabs on section detail page
window.switchSectionDetailTab = function(tab) {
  const overviewContent = document.getElementById('detailOverviewContent');
  const studentsContent = document.getElementById('detailStudentsContent');
  const overviewTab = document.getElementById('detailOverviewTab');
  const studentsTab = document.getElementById('detailStudentsTab');
  
  if (!overviewContent || !studentsContent || !overviewTab || !studentsTab) return;
  
  if (tab === 'overview') {
    overviewTab.classList.add('active');
    studentsTab.classList.remove('active');
    overviewTab.style.borderBottomColor = '#2563eb';
    studentsTab.style.borderBottomColor = 'transparent';
    overviewContent.style.display = 'block';
    studentsContent.style.display = 'none';
  } else if (tab === 'students') {
    overviewTab.classList.remove('active');
    studentsTab.classList.add('active');
    overviewTab.style.borderBottomColor = 'transparent';
    studentsTab.style.borderBottomColor = '#2563eb';
    overviewContent.style.display = 'none';
    studentsContent.style.display = 'block';
  }
};

// Switch between categories on section detail page
window.switchSectionDetailCategory = async function(category) {
  if (!currentSectionDetailSection) return;
  
  const files = await getDutyFilesForSection(currentSectionDetailSection.id || currentSectionDetailSection.firestoreId);
  const selectedFiles = files.filter(file => file.fileType === category);
  const grouped = selectedFiles.reduce((acc, file) => {
    const key = file.studentId || file.studentUid || file.studentEmail || file.studentName || 'Unknown Student';
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});
  
  const submissionHtml = selectedFiles.length === 0
    ? '<p style="color:#999; margin-top:12px;">No submissions in this category.</p>'
    : Object.entries(grouped).map(([studentKey, studentFiles]) => `
      <div class="student-folder-card" style="padding:12px; margin-bottom:12px;">
        <div class="folder-header" style="background:#f3f4f6; color:#111;">
          <div class="folder-header-info">
            <h4 style="margin:0;">${escapeHtml(studentFiles[0].studentName || studentKey)}</h4>
            <p style="font-size:13px; color:#4b5563;">${studentFiles.length} submission${studentFiles.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <div class="folder-content" style="padding:10px; gap:10px;">
          ${studentFiles.map(file => {
            const fileId = escapeHtml(file.firestoreId || file.id || '');
            const isLink = typeof file.fileContent === 'string' && /^(https?:\/\/)/i.test(file.fileContent);
            const actionBtn = isLink ? `<button class="open" onclick="openDutyLink('${fileId}')">Open</button>` : `<button class="open" onclick="downloadDutyFile('${fileId}')">Download</button>`;
            return `
              <div class="file-item" style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:10px;">
                <div class="file-info">
                  <div class="file-name">${escapeHtml(file.fileName || file.fileType || 'Submission')}</div>
                  <div class="file-meta">${escapeHtml(file.uploadDate ? new Date(file.uploadDate).toLocaleDateString() : 'Unknown date')}</div>
                </div>
                <div class="file-actions" style="display:flex; gap:8px; align-items:center;">
                  ${actionBtn}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  
  // Update UI
  currentSectionDetailCategory = category;
  
  const categoryTitle = document.getElementById('sectionDetailCategoryTitle');
  const submissionsContainer = document.getElementById('sectionDetailSubmissions');
  const buttons = document.querySelectorAll('.category-filter-btn');
  
  if (categoryTitle) categoryTitle.textContent = category;
  
  buttons.forEach(btn => {
    const isActive = btn.dataset.category === category;
    btn.classList.toggle('active', isActive);
    btn.style.borderColor = isActive ? '#2563eb' : '#cbd5e1';
    btn.style.background = isActive ? '#dbeafe' : '#f8fafc';
    btn.style.color = isActive ? '#1e40af' : '#374151';
    btn.style.fontWeight = isActive ? '600' : '500';
  });
  
  if (submissionsContainer) {
    submissionsContainer.style.opacity = '0.7';
    setTimeout(() => {
      submissionsContainer.innerHTML = submissionHtml;
      submissionsContainer.style.opacity = '1';
    }, 100);
  }
};

// Keep old modal functions for backward compatibility
window.switchModalTab = window.switchSectionDetailTab;
window.switchModalCategory = window.switchSectionDetailCategory;

async function createInstructorAnnouncement(sectionId) {
  const text = document.getElementById('instructorAnnouncementText')?.value.trim();
  if (!text) { showNotification('Please write announcement text.', 'warning'); return; }

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const authorName = currentUser.name || 'Instructor';
  const authorId = currentUser.uid || currentUser.id || '';

  try {
    await addDoc(collection(db, 'forum'), {
      type: 'announcement',
      title: 'Announcement',
      message: text,
      authorName,
      authorId,
      role: 'instructor',
      createdAt: serverTimestamp()
    });
    showNotification('Announcement posted.', 'success');
    loadAnnouncements();
  } catch (error) {
    console.error('Failed to post announcement:', error);
    showNotification('Unable to post announcement. Please try again.', 'error');
  }

  // Also add to section if sectionId provided
  if (sectionId) {
    const sectionRef = doc(db, 'sections', sectionId);
    const sectionDoc = await getDoc(sectionRef);
    const sectionData = sectionDoc.exists() ? sectionDoc.data() : {};
    const announcements = sectionData.announcements || [];
    announcements.unshift({ id: `ann_${Date.now()}`, text, authorName, createdAt: new Date().toISOString() });
    await updateDoc(sectionRef, { announcements });
    await loadInstructorSections();
    renderInstructorClassroomDetail({ ...sectionData, id: sectionId, announcements }, 'stream');
  }
}

async function createInstructorAssignment(sectionId) {
  const title = document.getElementById('instructorAssignmentTitle')?.value.trim();
  const description = document.getElementById('instructorAssignmentDesc')?.value.trim();
  const dueDate = document.getElementById('instructorAssignmentDue')?.value;

  if (!title || !description) { showNotification('Enter title and description', 'warning'); return; }

  const sectionRef = doc(db, 'sections', sectionId);
  const sectionDoc = await getDoc(sectionRef);
  const sectionData = sectionDoc.exists() ? sectionDoc.data() : {};
  const classwork = sectionData.classwork || [];

  classwork.unshift({ id: `cw_${Date.now()}`, title, description, dueDate });
  await updateDoc(sectionRef, { classwork });

  showNotification('Assignment created.', 'success');
  await loadInstructorSections();
  renderInstructorClassroomDetail({ ...sectionData, id: sectionId, classwork }, 'classwork');
}

async function addInstructorMaterial(sectionId) {
  const title = document.getElementById('instructorMaterialTitle')?.value.trim();
  const link = document.getElementById('instructorMaterialLink')?.value.trim();

  if (!title || !link) { showNotification('Enter material title and link.', 'warning'); return; }

  const sectionRef = doc(db, 'sections', sectionId);
  const sectionDoc = await getDoc(sectionRef);
  const sectionData = sectionDoc.exists() ? sectionDoc.data() : {};
  const materials = sectionData.materials || [];

  materials.unshift({ id: `mat_${Date.now()}`, title, link });
  await updateDoc(sectionRef, { materials });

  showNotification('Material added.', 'success');
  await loadInstructorSections();
  renderInstructorClassroomDetail({ ...sectionData, id: sectionId, materials }, 'classwork');
}

async function getStudentListForSection(sectionId) {
  try {
    const sectionDoc = await getDoc(doc(db, 'sections', sectionId));
    return sectionDoc.exists() ? (sectionDoc.data().students || []) : [];
  } catch (err) {
    console.warn('Unable to fetch student list:', err);
    return [];
  }
};

async function joinSectionByCode(code) {
  // now handled in student script; no-op in instructor script to avoid conflicts
  return;
}

async function deleteSection(sectionId) {
  const adminData = getAdminData();
  const section = (adminData.sections || []).find(sec => sec.id === sectionId);

  if (section && section.firestoreId) {
    try {
      await deleteDoc(doc(db, 'sections', section.firestoreId));
    } catch (error) {
      console.warn('Unable to delete section from Firestore:', error);
    }
  }

  adminData.sections = (adminData.sections || []).filter(sec => sec.id !== sectionId);
  saveAdminData(adminData);
  const currentSection = localStorage.getItem('currentInstructorSection');
  if (currentSection === sectionId) {
    localStorage.removeItem('currentInstructorSection');
    const detail = document.getElementById('instructorSectionDetail');
    if (detail) detail.innerHTML = '';
  }
  await loadInstructorSections();
  showNotification('Section removed.', 'info');
}

function updateInstructorStats(schedules, labs, sections = []) {
  const studentIds = new Set();
  schedules.forEach(schedule => {
    if (schedule.studentId && schedule.studentId.trim()) {
      studentIds.add(schedule.studentId.trim());
    } else if (schedule.studentUid && schedule.studentUid.trim()) {
      studentIds.add(schedule.studentUid.trim());
    }
  });

  const pending = (labs || []).filter(l => !l.reviewed || l.reviewed === false).length;
  const reviewed = (labs || []).filter(l => l.reviewed === true).length;

  const studentCountEl = document.getElementById('scheduleStudentCount');
  const pendingCountEl = document.getElementById('pendingLabCount');
  const reviewedCountEl = document.getElementById('reviewedLabCount');
  const sectionCountEl = document.getElementById('sectionCount');

  if (studentCountEl) studentCountEl.textContent = String(studentIds.size);
  if (pendingCountEl) pendingCountEl.textContent = String(pending);
  if (reviewedCountEl) reviewedCountEl.textContent = String(reviewed);
  if (sectionCountEl) sectionCountEl.textContent = String(sections.length);
}

function setupScheduleFormListeners() {
  const addScheduleBtn = document.getElementById('addScheduleBtn');
  if (addScheduleBtn) {
      addScheduleBtn.addEventListener('click', async () => {
  const studentId = document.getElementById('scheduleStudentId').value.trim();
  const date = document.getElementById('scheduleDate').value;
  const hospital = document.getElementById('scheduleHospital').value.trim();
  const ward = document.getElementById('scheduleWard').value.trim();
  const shift = document.getElementById('scheduleShift').value.trim();

  if (!studentId || !date || !hospital || !ward || !shift) {
    showNotification('Please fill all schedule fields.', 'warning');
    return;
  }

  let studentUid = '';
  let resolvedStudentName = '';

  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    let foundStudent = null;

    usersSnapshot.forEach(docSnap => {
      const u = docSnap.data();
      if (!u || u.role !== 'student') return;

      if (
        u.studentId === studentId ||
        u.email === studentId ||
        u.id === studentId ||
        docSnap.id === studentId
      ) {
        foundStudent = { uid: docSnap.id, ...u };
      }
    });

    if (!foundStudent) {
      showNotification('Invalid student ID. Please enter a registered student ID.', 'error');
      return;
    }

    studentUid = foundStudent.uid;
    resolvedStudentName = foundStudent.name || 'Unknown Student';

  } catch (err) {
    console.error('Failed to lookup student user:', err);
    showNotification('Student validation failed. Please try again.', 'error');
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

  const scheduleEntry = {
    studentId,
    studentUid,
    studentName: resolvedStudentName, // ✅ auto-filled
    studentLegacyId: studentId,
    date,
    hospital,
    ward,
    shift,
    instructor: currentUser.name || 'Instructor',
    instructorId: currentUser.id || currentUser.uid || '',
    instructorUid: currentUser.id || currentUser.uid || '',
    createdAt: serverTimestamp()
  };

  const adminData = getAdminData();
  adminData.schedules = adminData.schedules || [];

  const localScheduleId = 'sch_' + Date.now();
  adminData.schedules.push({ id: localScheduleId, ...scheduleEntry });
  saveAdminData(adminData);

  try {
    const docRef = await addDoc(collection(db, 'schedules'), scheduleEntry);
    const idx = adminData.schedules.findIndex(s => s.id === localScheduleId);
    if (idx !== -1) {
      adminData.schedules[idx].firestoreId = docRef.id;
      saveAdminData(adminData);
    }
  } catch (error) {
    console.error('Failed to sync schedule to Firestore:', error);
  }

  const filteredSchedules = adminData.schedules.filter(
    s => s.instructorUid === scheduleEntry.instructorUid
  );

  const uniqueSchedules = Array.from(
    new Map(filteredSchedules.map(s => [s.firestoreId || s.id, s])).values()
  );

  renderScheduleTable(uniqueSchedules);
  clearScheduleForm();
  showNotification('Schedule added successfully.', 'success');
});
  }

}

function clearScheduleForm() {
  ['scheduleStudentName', 'scheduleStudentId', 'scheduleDate', 'scheduleHospital', 'scheduleWard', 'scheduleShift'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function clearLabForm() {
  ['labStudentName', 'labStudentId', 'labTestName', 'labDate', 'labStatus', 'labNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const statusEl = document.getElementById('labStatus');
  if (statusEl) statusEl.value = 'Pending';
}

function getDisplayStudentId(studentId, studentUid) {
  if (!studentId || studentId === studentUid) {
    return '';
  }
  return studentId;
}

function formatScheduleDate(dateValue) {
  if (!dateValue) return 'N/A';
  const dateString = String(dateValue).trim();
  if (!dateString) return 'N/A';

  // If user supplied a human-friendly range like "Feb 26-27" or "March 6-12", keep it as-is.
  // If it's a valid Date string, display localized date.
  const parsed = new Date(dateString);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString();
  }

  return dateString;
}

function renderScheduleTable(schedules) {
  const body = document.getElementById('scheduleTableBody');
  if (!body) return;
  body.innerHTML = '';
  if (!schedules || schedules.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666; padding:10px;">No schedules found.</td></tr>';
    return;
  }
  schedules.forEach(entry => {
    const studentDisplay = escapeHtml(entry.studentName || 'Unknown Student');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatScheduleDate(entry.date)}</td>
      <td>${studentDisplay}</td>
      <td>${escapeHtml(entry.hospital)}</td>
      <td>${escapeHtml(entry.ward)}</td>
      <td>${escapeHtml(entry.shift)}</td>
      <td><button class="primary" style="background:#e53e3e;padding:6px 10px;font-size:12px;" onclick="deleteSchedule('${entry.id}')">Delete</button></td>
    `;
    body.appendChild(row);
  });
}

const labNotesStore = {};

function renderLabTable(labs) {
  const body = document.getElementById('labTableBody');
  if (!body) return;
  body.innerHTML = '';
  if (!labs || labs.length === 0) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666; padding:10px;">No lab tests recorded.</td></tr>';
    return;
  }

  labs.forEach(lab => {
    const reviewed = lab.reviewed ? 'Reviewed' : 'Pending';
    const reviewedClass = lab.reviewed ? 'status-completed' : 'status-pending';
    const studentDisplay = escapeHtml(lab.studentName || 'Unknown Student');

    labNotesStore[lab.id] = {
      notes: lab.notes || '',
      studentName: lab.studentName || 'N/A',
      testName: lab.testName || 'N/A',
      date: lab.date || ''
    };

    const notePreviewText = lab.notes ? (lab.notes.length > 40 ? `${lab.notes.slice(0, 40)}...` : lab.notes) : 'No notes';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${studentDisplay}</td>
      <td>${escapeHtml(lab.testName || 'N/A')}</td>
      <td>${lab.date ? new Date(lab.date).toLocaleDateString() : 'N/A'}</td>
      <td>${escapeHtml(lab.result || 'N/A')}</td>
      <td>${lab.notes ? `<button class="notes-preview-btn" type="button" onclick="openLabNotesModal('${lab.id}')">${escapeHtml(notePreviewText)}</button>` : 'N/A'}</td>
      <td>
        <span class="status-badge ${reviewedClass}">${reviewed}</span>
        <div style="margin-top:6px; display:flex; gap:6px; justify-content:center;">
          <button class="primary" style="background:#2f855a;padding:6px 10px;font-size:12px;" onclick="toggleLabReview('${lab.id}')">${lab.reviewed ? 'Unmark' : 'Reviewed'}</button>
          <button class="primary" style="background:#e53e3e;padding:6px 10px;font-size:12px;" onclick="deleteLab('${lab.id}')">Delete</button>
        </div>
      </td>
    `;
    body.appendChild(row);
  });
}

function openLabNotesModal(labId) {
  const record = labNotesStore[labId];
  if (!record) {
    showNotification('Lab notes not found.', 'warning');
    return;
  }

  const modal = ensureLabNotesModal();
  modal.querySelector('.modal-title').textContent = `Lab notes from ${record.studentName}`;
  modal.querySelector('.modal-subtitle').textContent = `${record.testName} | ${record.date ? new Date(record.date).toLocaleDateString() : 'Unknown date'}`;
  modal.querySelector('.modal-body').textContent = record.notes || 'No notes provided.';
  modal.classList.remove('hidden');
}

function closeLabNotesModal() {
  const modal = document.getElementById('labNotesModal');
  if (!modal) return;
  modal.classList.add('hidden');
}

function ensureLabNotesModal() {
  let modal = document.getElementById('labNotesModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'labNotesModal';
  modal.className = 'notes-modal hidden';
  modal.innerHTML = `
    <div class="notes-modal-content">
      <div class="notes-modal-header">
        <h3 class="modal-title">Lab Notes</h3>
        <button class="close-modal" type="button">✕</button>
      </div>
      <div class="modal-subtitle"></div>
      <div class="modal-body" style="margin-top:10px; white-space: pre-wrap; color:#333;"></div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('.close-modal').addEventListener('click', closeLabNotesModal);
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeLabNotesModal();
    }
  });

  return modal;
}

window.openLabNotesModal = openLabNotesModal;
window.closeLabNotesModal = closeLabNotesModal;


async function toggleLabReview(id) {
  const adminData = getAdminData();
  let updatedLab = null;
  adminData.labs = (adminData.labs || []).map(l => {
    if (l.id === id) {
      updatedLab = { ...l, reviewed: !l.reviewed };
      return updatedLab;
    }
    return l;
  });
  saveAdminData(adminData);

  // Update Firestore if lab exists there
  try {
    const firestoreId = updatedLab?.firestoreId || id;
    if (firestoreId) {
      await updateDoc(doc(db, 'labs', firestoreId), { reviewed: updatedLab.reviewed });
    }
  } catch (err) {
    console.warn('Failed to update lab reviewed status in Firestore:', err);
  }

  renderLabTable(adminData.labs);
}
window.toggleLabReview = toggleLabReview;

async function deleteSchedule(id) {
  if (!confirm('Are you sure you want to delete this schedule?')) {
    return;
  }
  const adminData = getAdminData();
  const scheduleToDelete = (adminData.schedules || []).find(item => item.id === id || item.firestoreId === id);
  let firestoreId = id;
  if (scheduleToDelete) {
    firestoreId = scheduleToDelete.firestoreId || id;
  }

  try {
    if (firestoreId) {
      await deleteDoc(doc(db, 'schedules', firestoreId));
    }
  } catch (err) {
    console.warn('Unable to delete Firestore schedule (might not exist):', err);
  }

  adminData.schedules = (adminData.schedules || []).filter(item => item.id !== id && item.firestoreId !== id);
  saveAdminData(adminData);

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const filteredSchedules = (adminData.schedules || []).filter(s => s.instructorUid === currentUser.id || s.instructorId === currentUser.id || s.instructorUid === currentUser.uid || s.instructorId === currentUser.uid);
  renderScheduleTable(filteredSchedules);
  showNotification('Schedule removed.', 'info');
}
window.deleteSchedule = deleteSchedule;

async function deleteLab(id) {
  if (!confirm('Are you sure you want to delete this lab entry?')) {
    return;
  }
  const adminData = getAdminData();
  const labToDelete = (adminData.labs || []).find(item => item.id === id || item.firestoreId === id);
  let firestoreId = id;
  if (labToDelete) {
    firestoreId = labToDelete.firestoreId || id;
  }

  try {
    if (firestoreId) {
      await deleteDoc(doc(db, 'labs', firestoreId));
    }
  } catch (err) {
    console.warn('Unable to delete Firestore lab (might not exist):', err);
  }

  adminData.labs = (adminData.labs || []).filter(item => item.id !== id && item.firestoreId !== id);
  saveAdminData(adminData);
  renderLabTable(adminData.labs);
  showNotification('Lab result removed.', 'info');
}
window.deleteLab = deleteLab;

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
  sections.forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.remove('hidden');

  if (sectionId === 'classrooms') {
    loadInstructorDutyView();
  }

  // Set up forum listener when forum section is shown
  if (sectionId === 'forum') {
    loadForumPosts();
  } else {
    // Clean up forum listener when leaving forum section
    cleanupForumListener();
  }

  if (event && event.currentTarget) {
    event.preventDefault();
  }

  setActiveNavLink(sectionId);
  localStorage.setItem(SECTION_STORAGE_KEY, sectionId);
}

window.showSection = showSection;

async function getDutyFilesForSection(sectionId) {
  if (!sectionId) return [];
  const localDutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const section = getInstructorSections().find(s => s.id === sectionId || s.firestoreId === sectionId);
  const studentIds = (section?.students || []).map(s => s?.id || s?.studentUid || s?.email).filter(id => id && typeof id === 'string');
  const matchedFiles = localDutyFiles.filter(file => file.sectionId === sectionId || (studentIds.length && studentIds.includes(file.studentId || file.studentUid || file.studentEmail || '')));

  const remoteFiles = [];
  try {
    const sectionQuery = query(collection(db, 'dutyRequirements'), where('sectionId', '==', sectionId));
    const sectionSnapshot = await getDocs(sectionQuery);
    sectionSnapshot.forEach(docSnap => {
      remoteFiles.push({ firestoreId: docSnap.id, ...docSnap.data() });
    });

    if (studentIds.length > 0 && remoteFiles.length === 0) {
      const batchedIds = studentIds.slice(0, 10);
      const studentQuery = query(collection(db, 'dutyRequirements'), where('studentId', 'in', batchedIds));
      const studentSnapshot = await getDocs(studentQuery);
      studentSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (!data) return;
        if (data.sectionId === sectionId || batchedIds.includes(data.studentId || data.studentUid || data.studentEmail || '')) {
          remoteFiles.push({ firestoreId: docSnap.id, ...data });
        }
      });
    }
  } catch (err) {
    console.error('Failed to load duty requirement files for section:', err);
  }

  const allFiles = [...matchedFiles, ...remoteFiles];
  const unique = new Map();
  allFiles.forEach(file => {
    const key = file.firestoreId || file.id || `${file.studentId || file.studentUid || 'unknown'}-${file.fileName || file.fileType || ''}-${file.uploadDate || ''}`;
    if (!unique.has(key)) unique.set(key, file);
  });
  return Array.from(unique.values());
}

async function loadInstructorDutyView() {
  const container = document.getElementById('instructorSectionsContainer');
  const detail = document.getElementById('instructorSectionDetail');
  if (!container || !detail) return;

  const sections = getInstructorSections();
  if (!sections || sections.length === 0) {
    container.innerHTML = '<p style="color:#999; padding:12px;">No sections created yet. Create one above to start managing your classroom.</p>';
    detail.innerHTML = '';
    return;
  }

  renderInstructorSections(sections);
  detail.innerHTML = '<p style="color:#4b5563; padding:12px;">Select a section folder to view enrolled students and duty requirement submissions.</p>';
}
window.loadInstructorDutyView = loadInstructorDutyView;

// Export new page-based navigation functions
window.navigateToSectionDetail = navigateToSectionDetail;
window.renderSectionDetailPage = renderSectionDetailPage;
window.openInstructorClassroom = openInstructorClassroom;
window.openInstructorSectionModal = openInstructorSectionModal;


async function deleteDutyFile(fileId) {
  if (!confirm('Are you sure you want to delete this duty file?')) {
    return;
  }

  let dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const target = dutyFiles.find(file => file.id === fileId || file.firestoreId === fileId);

  if (target && target.firestoreId) {
    try {
      await deleteDoc(doc(db, 'dutyRequirements', target.firestoreId));
      showNotification('Duty file removed from Firestore.', 'success');
    } catch (err) {
      console.warn('Failed to delete duty file from Firestore:', err);
      showNotification('Could not delete from Firestore, but local copy will be removed.', 'warning');
    }
  }

  dutyFiles = dutyFiles.filter(file => file.id !== fileId && file.firestoreId !== fileId);
  localStorage.setItem('dutyRequirementFiles', JSON.stringify(dutyFiles));
  await loadInstructorDutyView();
  showNotification('Duty file deleted.', 'info');
}
window.deleteDutyFile = deleteDutyFile;

async function downloadDutyFile(fileId) {
  let dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  let file = dutyFiles.find(file => file.id === fileId || file.firestoreId === fileId);

  if (!file && fileId) {
    try {
      const docSnap = await getDoc(doc(db, 'dutyRequirements', fileId));
      if (docSnap.exists()) {
        file = { firestoreId: docSnap.id, ...docSnap.data() };
      }
    } catch (err) {
      console.error('Failed to fetch duty file from Firestore for download:', err);
    }
  }

  if (!file) {
    showNotification('File not found!', 'warning');
    return;
  }

  const content = file.fileContent || file.fileUrl;
  if (!content) {
    showNotification('File data not available for download!', 'warning');
    return;
  }

  const link = document.createElement('a');
  link.href = content;
  link.download = file.fileName || `${file.fileType || 'duty'}-submission`;
  link.click();
  showNotification('Downloading file...', 'success');
}
window.downloadDutyFile = downloadDutyFile;

function openDutyLink(fileId) {
  const dutyFiles = JSON.parse(localStorage.getItem('dutyRequirementFiles') || '[]');
  const file = dutyFiles.find(f => f.id === fileId || f.firestoreId === fileId);

  if (file && file.fileContent && /^(https?:\/\/)/i.test(file.fileContent)) {
    window.open(file.fileContent, '_blank');
    showNotification('Opening link in a new tab...', 'success');
    return;
  }

  if (!fileId) {
    showNotification('Link not available.', 'warning');
    return;
  }

  const newWindow = window.open('about:blank', '_blank');
  if (!newWindow) {
    showNotification('Unable to open link. Please allow popups for this site.', 'warning');
    return;
  }

  getDoc(doc(db, 'dutyRequirements', fileId)).then(docSnap => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.fileContent && /^(https?:\/\/)/i.test(data.fileContent)) {
        newWindow.location.href = data.fileContent;
        showNotification('Opening link in a new tab...', 'success');
      } else {
        newWindow.close();
        showNotification('Invalid URL.', 'warning');
      }
    } else {
      newWindow.close();
      showNotification('Link not available.', 'warning');
    }
  }).catch(err => {
    newWindow.close();
    console.error('Failed to fetch duty file from Firestore for open link:', err);
    showNotification('Link not available.', 'warning');
  });
}
window.openDutyLink = openDutyLink;

// Priority utility functions (shared)
function getPriorityValue(priority) {
  switch (priority?.toLowerCase() || 'normal') {
    case 'urgent': return 3;
    case 'important': return 2;
    case 'normal': return 1;
    default: return 1;
  }
}

function getPriorityEmojiAndColor(priority) {
  switch (priority?.toLowerCase() || 'normal') {
    case 'urgent': return { emoji: '🚨', color: '#ef4444', className: 'priority-urgent' };
    case 'important': return { emoji: '⚠️', color: '#f59e0b', className: 'priority-important' };
    case 'normal': return { emoji: '💬', color: '#3b82f6', className: 'priority-normal' };
    default: return { emoji: '📢', color: '#f59e0b', className: 'post' };
  }
}

// REQUIRED: getPriorityInfo used by loadAnnouncements
function getPriorityInfo(priority) {
  const p = priority?.toLowerCase() || 'normal';
  const infos = {
    normal: { emoji: '💬', color: '#3b82f6', label: 'Normal', className: 'priority-normal' },
    important: { emoji: '⚠️', color: '#f59e0b', label: 'Important', className: 'priority-important' },
    urgent: { emoji: '🚨', color: '#ef4444', label: 'Urgent', className: 'priority-urgent pinned-top' }
  };
  return infos[p] || infos.normal;
}

async function loadAnnouncements() {
  const container = document.getElementById('announcementsContainer');
  if (!container) return;
  container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Loading announcements...</p>';

  try {
    const snap = await getDocs(query(collection(db, 'forum'), where('type', '==', 'announcement')));
    let announcements = snap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

    // PRIORITY SORT: Urgent first, then createdAt DESC within priority
    announcements.sort((a, b) => {
      const prioA = getPriorityValue(a.priority);
      const prioB = getPriorityValue(b.priority);
      if (prioA !== prioB) return prioB - prioA;
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    if (announcements.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No announcements yet. Post updates for students.</p>';
      return;
    }

    container.innerHTML = '';
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const currentUserId = currentUser.uid || currentUser.id || '';
    announcements.forEach(announcement => {
      const priorityInfo = getPriorityInfo(announcement.priority);
      const card = document.createElement('div');
      card.className = `post ${priorityInfo.className}`;
      card.style.borderLeftColor = priorityInfo.color;
      const createdAt = announcement.createdAt?.toDate ? announcement.createdAt.toDate() : new Date(announcement.createdAt || Date.now());
      const isOwn = announcement.authorId === currentUserId;
      const deleteBtn = isOwn ? `<button class="announcement-delete-btn" onclick="deleteOwnAnnouncement('${announcement.id}')" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;">🗑️ Delete</button>` : '';
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
  } catch (err) {
    console.error('Error loading announcements from Firestore:', err);
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load announcements right now.</p>';
  }
}

window.deleteOwnAnnouncement = async function(announcementId) {
  if (!confirm('Are you sure you want to delete your announcement?')) return;
  
  try {
    await deleteDoc(doc(db, 'forum', announcementId));
    showNotification('Announcement deleted successfully.', 'success');
    await loadAnnouncements(); // Refresh announcements
  } catch (error) {
    console.error('Failed to delete announcement:', error);
    showNotification('Failed to delete announcement. Please try again.', 'error');
  }
};

// Announcement POST functions (Instructor)
// Instructor Announcement Modal Functions
function openInstructorAnnouncementModal() {
  document.getElementById('instructorAnnouncementModal').style.display = 'flex';
}
window.openInstructorAnnouncementModal = openInstructorAnnouncementModal;

function closeInstructorAnnouncementModal() {
  document.getElementById('instructorAnnouncementModal').style.display = 'none';
}
window.closeInstructorAnnouncementModal = closeInstructorAnnouncementModal;

async function addInstructorAnnouncement(event) {
  event.preventDefault();
  
  const title = document.getElementById('instructorAnnouncementTitle').value.trim();
  const message = document.getElementById('instructorAnnouncementMessage').value.trim();
  const priority = document.getElementById('instructorAnnouncementPriority').value;

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
      authorName: currentUser.name || 'Instructor',
      role: 'instructor',
      createdAt: serverTimestamp()
    });

    closeInstructorAnnouncementModal();
    document.getElementById('instructorAnnouncementTitle').value = '';
    document.getElementById('instructorAnnouncementMessage').value = '';
    document.getElementById('instructorAnnouncementPriority').value = 'Normal';
    
    showNotification('✅ Announcement posted!', 'success');
    await loadAnnouncements(); // Refresh with priority sorting
  } catch (error) {
    console.error('Failed to post announcement:', error);
    showNotification('❌ Failed to post announcement.', 'error');
  }
}
window.addInstructorAnnouncement = addInstructorAnnouncement;

window.deleteForumPost = async function(postId) {
  if (!confirm('Are you sure you want to delete this post?')) return;

  try {
    await deleteDoc(doc(db, 'forum', postId));
    showNotification('Post deleted.', 'success');
    loadAnnouncements();
    if (forumListener) {
      // Reload forum discussions if listener is active
      loadForumDiscussions();
    }
  } catch (error) {
    console.error('Failed to delete post:', error);
    showNotification('Unable to delete post. Please try again.', 'error');
  }
};

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
  const role = currentUser.role || 'instructor';
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
      <strong>${escapeHtml(comment.authorName || 'Anonymous')} (${escapeHtml(comment.role || 'instructor')})</strong>
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

async function loadForumPosts() {
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
        const postEl = createForumPostElement(
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
        container.appendChild(postEl);
      });
    }, (error) => {
      console.error('Failed to listen to forum discussions:', error);
      container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load forum discussions right now.</p>';
    });
  } catch (err) {
    console.error('Error setting up forum listener:', err);
    container.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">Unable to load forum discussions right now.</p>';
  }
}

function cleanupForumListener() {
  if (forumListener) {
    forumListener();
    forumListener = null;
  }
}

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
      if (!confirm('Delete this discussion post?')) return;
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

function setupInstructorEventListeners() {
  const forumInput = document.getElementById('forumInput');
  const forumCharCount = document.getElementById('forumCharCount');
  if (forumInput && forumCharCount) {
    forumInput.addEventListener('input', function() {
      forumCharCount.textContent = `${this.value.length} / 500`;
    });
  }

  const generateSectionBtn = document.getElementById('generateSectionBtn');
  if (generateSectionBtn) {
    generateSectionBtn.addEventListener('click', async () => {
      const sectionName = document.getElementById('sectionName')?.value.trim();
      const output = document.getElementById('sectionCodeOutput');

      if (!sectionName) {
        showNotification('Please provide a section name.', 'warning');
        return;
      }

      const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
      const code = generateSectionCode(8);
      const sectionId = 'section_' + Date.now();
      const newSection = {
        id: sectionId,
        code,
        name: sectionName,
        instructorName: currentUser.name || 'Instructor',
        instructorId: currentUser.id || currentUser.uid || '',
        createdAt: new Date().toISOString(),
        color: '#dc2626',
        announcements: [],
        classwork: [],
        materials: [],
        students: []
      };

      const existingCodes = new Set(getInstructorSections().map(s => s.code));
      while (existingCodes.has(newSection.code)) {
        newSection.code = generateSectionCode(8);
      }

      saveInstructorSection(newSection);
      try {
        const { id: localId, ...sectionForFirestore } = newSection;
        const docRef = await addDoc(collection(db, 'sections'), {
          ...sectionForFirestore,
          createdAt: serverTimestamp()
        });
        const adminData = getAdminData();
        const idx = (adminData.sections || []).findIndex(s => s.id === newSection.id);
        if (idx !== -1) {
          adminData.sections[idx].firestoreId = docRef.id;
          adminData.sections[idx].id = docRef.id;
          saveAdminData(adminData);
        }
      } catch (error) {
        console.error('Failed to save section to Firestore:', error);
        showNotification('Could not save section to Firebase. Section still saved locally.', 'warning');
      }

      await loadInstructorSections();
      if (output) {
        output.textContent = `Section created: ${newSection.code}`;
      }
      document.getElementById('sectionName').value = '';
      showNotification(`Section code generated: ${newSection.code}`, 'success');
    });
  }
}


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

window.openColorPicker = function() {
  const colors = [
    { name: 'Blue', value: '#2563eb' },
    { name: 'Purple', value: '#7c3aed' },
    { name: 'Pink', value: '#db2777' },
    { name: 'Orange', value: '#ea580c' },
    { name: 'Green', value: '#16a34a' },
    { name: 'Cyan', value: '#0891b2' },
    { name: 'Amber', value: '#d97706' },
    { name: 'Red', value: '#dc2626' },
    { name: 'Indigo', value: '#4f46e5' },
    { name: 'Teal', value: '#14b8a6' }
  ];

  const modal = document.createElement('div');
  modal.id = 'colorPickerModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
  
  const content = document.createElement('div');
  content.style.cssText = 'background:white;padding:24px;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.2);max-width:500px;width:90%;';
  
  content.innerHTML = `
    <h2 style="margin-top:0;color:#1f2937;font-size:20px;">Choose Section Color</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(80px, 1fr));gap:12px;margin:20px 0;">
      ${colors.map(color => `
        <button onclick="updateSectionColor('${color.value}')" style="width:100%;aspect-ratio:1;background:${color.value};border:3px solid #e5e7eb;border-radius:8px;cursor:pointer;transition:all 0.2s;font-size:12px;color:white;font-weight:500;text-shadow:0 1px 2px rgba(0,0,0,0.3);" onmouseover="this.style.border='3px solid #333'" onmouseout="this.style.border='3px solid #e5e7eb'">${color.name}</button>
      `).join('')}
    </div>
    <button onclick="document.getElementById('colorPickerModal').remove()" style="width:100%;padding:10px;background:#6b7280;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Cancel</button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
};

window.updateSectionColor = async function(color) {
  if (!currentSectionDetailSection) {
    showNotification('No section selected.', 'error');
    return;
  }

  const sectionId = currentSectionDetailSection.id || currentSectionDetailSection.firestoreId;
  
  try {
    // Update Firestore
    if (currentSectionDetailSection.firestoreId) {
      await updateDoc(doc(db, 'sections', currentSectionDetailSection.firestoreId), {
        color: color
      });
    }

    // Update local storage
    const adminData = getAdminData();
    const idx = (adminData.sections || []).findIndex(s => s.id === sectionId || s.firestoreId === sectionId);
    if (idx !== -1) {
      adminData.sections[idx].color = color;
      saveAdminData(adminData);
    }

    // Update current section object
    currentSectionDetailSection.color = color;

    // Close color picker
    const modal = document.getElementById('colorPickerModal');
    if (modal) modal.remove();

    // Reload sections to show new color
    await loadInstructorSections();
    showNotification('Section color updated!', 'success');
  } catch (error) {
    console.error('Failed to update section color:', error);
    showNotification('Unable to update section color. Please try again.', 'error');
  }
};

async function addForumPost() {
  const input = document.getElementById('forumInput');
  const charCountEl = document.getElementById('forumCharCount');
  const text = input.value.trim();

  if (text === '') {
    showNotification('Please write a discussion first!', 'warning');
    return;
  }
  if (text.length > 500) {
    showNotification('Discussion is too long! (Max 500 characters)', 'warning');
    return;
  }

  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const authorName = currentUser.name || 'Unknown';
  const role = currentUser.role || 'instructor';
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
    showNotification('Discussion posted! ', 'success');
  } catch (error) {
    console.error('Failed to post discussion to Firestore:', error);
    showNotification('Unable to post discussion. Please try again.', 'error');
  }
}

window.addForumPost = addForumPost;
window.loadForumPosts = loadForumPosts;
window.deleteSection = deleteSection;
window.openInstructorClassroom = openInstructorClassroom;
window.createInstructorAnnouncement = createInstructorAnnouncement;
window.createInstructorAssignment = createInstructorAssignment;
window.addInstructorMaterial = addInstructorMaterial;

// New functions for section actions
async function copySectionCode() {
  if (!currentSectionDetailSection || !currentSectionDetailSection.code) {
    showNotification('Section code not available.', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(currentSectionDetailSection.code);
    showNotification('Section code copied to clipboard!', 'success');
  } catch (err) {
    console.error('Failed to copy section code:', err);
    showNotification('Failed to copy section code.', 'error');
  }
}

window.copySectionCode = copySectionCode;

async function deleteCurrentSection() {
  if (!currentSectionDetailSection) {
    showNotification('No section selected.', 'warning');
    return;
  }

  const sectionName = currentSectionDetailSection.name || 'this section';
  if (!confirm(`Are you sure you want to delete "${sectionName}"? This action cannot be undone and will remove all associated data.`)) {
    return;
  }

  const sectionId = currentSectionDetailSection.id || currentSectionDetailSection.firestoreId;
  if (!sectionId) {
    showNotification('Section ID not found.', 'error');
    return;
  }

  try {
    // Delete from Firestore
    if (currentSectionDetailSection.firestoreId) {
      await deleteDoc(doc(db, 'sections', currentSectionDetailSection.firestoreId));
    }

    // Delete from local storage
    const adminData = getAdminData();
    adminData.sections = (adminData.sections || []).filter(sec => sec.id !== sectionId && sec.firestoreId !== sectionId);
    saveAdminData(adminData);

    // Clear current section
    localStorage.removeItem(SECTION_STORAGE_KEY);
    currentSectionDetailSection = null;

    // Go back to classrooms list
    goBackToClassrooms();

    // Reload sections
    await loadInstructorSections();

    showNotification('Section deleted successfully.', 'info');
  } catch (error) {
    console.error('Failed to delete section:', error);
    showNotification('Failed to delete section. Please try again.', 'error');
  }
}

window.deleteCurrentSection = deleteCurrentSection;
