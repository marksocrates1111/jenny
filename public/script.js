function formatDate(isoDate) {
  try {
    return new Date(isoDate).toLocaleString();
  } catch (error) {
    return isoDate;
  }
}

function setStatus(el, text, tone = 'default') {
  if (!el) {
    return;
  }

  el.textContent = text;
  el.classList.remove('success', 'error', 'muted');

  if (tone === 'success') {
    el.classList.add('success');
  } else if (tone === 'error') {
    el.classList.add('error');
  } else if (tone === 'muted') {
    el.classList.add('muted');
  }
}

function createCell(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}

let adminPanelInitialized = false;
let selectedConversationId = null;

function getStoredVisitorProfile() {
  try {
    const raw = localStorage.getItem('rtfm_visitor_profile');
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function saveVisitorProfile(profile) {
  try {
    localStorage.setItem('rtfm_visitor_profile', JSON.stringify(profile));
  } catch (error) {
    // Ignore storage errors to avoid blocking feedback submission.
  }
}

function loadIntercomScript(appId) {
  return new Promise((resolve, reject) => {
    if (window.Intercom && typeof window.Intercom === 'function') {
      resolve();
      return;
    }

    const existingScript = document.getElementById('intercom-widget-script');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Intercom script failed to load.')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'intercom-widget-script';
    script.async = true;
    script.src = `https://widget.intercom.io/widget/${appId}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Intercom script failed to load.'));
    document.head.appendChild(script);
  });
}

async function initIntercomMessenger() {
  try {
    const response = await fetch('/api/feedback/messenger-config');
    const config = await response.json();

    if (!response.ok || !config.enabled || !config.appId) {
      return;
    }

    const profile = getStoredVisitorProfile();
    const settings = {
      app_id: config.appId,
      api_base: config.apiBase || 'https://api-iam.intercom.io'
    };

    if (profile && profile.email) {
      settings.email = profile.email;
    }

    if (profile && profile.name) {
      settings.name = profile.name;
    }

    window.intercomSettings = settings;
    await loadIntercomScript(config.appId);

    if (window.Intercom && typeof window.Intercom === 'function') {
      window.Intercom('boot', settings);
    }
  } catch (error) {
    console.error('Messenger init failed:', error.message);
  }
}

async function submitFeedback(event) {
  event.preventDefault();

  const form = event.target;
  const statusEl = document.getElementById('formStatus');
  const submitButton = form.querySelector('button[type="submit"]');

  const formData = new FormData(form);
  const payload = {
    name: (formData.get('name') || '').toString().trim(),
    email: (formData.get('email') || '').toString().trim(),
    message: (formData.get('message') || '').toString().trim()
  };

  if (!payload.name || !payload.email || !payload.message) {
    setStatus(statusEl, 'Please fill in all fields.', 'error');
    return;
  }

  submitButton.disabled = true;
  setStatus(statusEl, 'Sending your message...');

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      setStatus(statusEl, result.error || 'Failed to submit feedback.', 'error');
      return;
    }

    if (result.intercom && result.intercom.sent) {
      setStatus(statusEl, 'Message sent and synced to Intercom.', 'success');
    } else if (result.intercom && result.intercom.skipped) {
      setStatus(statusEl, 'Saved locally. Configure Intercom token to enable sync.', 'muted');
    } else {
      setStatus(statusEl, 'Saved locally, but Intercom sync failed. Check backend logs.', 'error');
    }

    // Save user details for Intercom Messenger boot/update.
    saveVisitorProfile({
      name: payload.name,
      email: payload.email
    });

    if (window.Intercom && typeof window.Intercom === 'function') {
      window.Intercom('update', {
        name: payload.name,
        email: payload.email
      });
    }

    form.reset();
  } catch (error) {
    setStatus(statusEl, 'Could not connect to server. Please try again.', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

async function loadIntercomStatus() {
  const statusEl = document.getElementById('intercomStatus');

  if (!statusEl) {
    return;
  }

  try {
    const response = await fetch('/api/feedback/intercom-status');
    const data = await response.json();

    if (!response.ok) {
      setStatus(statusEl, 'Could not load Intercom status.', 'error');
      return;
    }

    if (data.configured) {
      setStatus(statusEl, 'Intercom status: Connected configuration found.', 'success');
    } else {
      setStatus(statusEl, 'Intercom status: Not configured yet. Feedback will be local only.', 'muted');
    }
  } catch (error) {
    setStatus(statusEl, 'Intercom status could not be checked.', 'error');
  }
}

async function loadFeedbackRecords() {
  const tableBody = document.getElementById('feedbackTableBody');
  const statusEl = document.getElementById('adminStatus');

  if (!tableBody) {
    return;
  }

  setStatus(statusEl, 'Loading records...');
  tableBody.innerHTML = '';

  try {
    const response = await fetch('/api/feedback');
    const records = await response.json();

    if (!response.ok) {
      setStatus(statusEl, records.error || 'Failed to load records.', 'error');
      return;
    }

    if (!Array.isArray(records) || records.length === 0) {
      setStatus(statusEl, 'No feedback records yet.', 'muted');
      return;
    }

    for (const item of records) {
      const row = document.createElement('tr');

      row.appendChild(createCell(item.id || ''));
      row.appendChild(createCell(item.name || ''));
      row.appendChild(createCell(item.email || ''));
      row.appendChild(createCell(item.message || ''));

      const statusCell = document.createElement('td');
      const badge = document.createElement('span');
      const statusText = item.status || 'new';
      badge.className = `status-badge ${statusText}`;
      badge.textContent = statusText;
      statusCell.appendChild(badge);
      row.appendChild(statusCell);

      row.appendChild(createCell(formatDate(item.createdAt)));
      tableBody.appendChild(row);
    }

    setStatus(statusEl, `Loaded ${records.length} record(s).`, 'muted');
  } catch (error) {
    setStatus(statusEl, 'Could not load records. Please try again.', 'error');
  }
}

function extractPrimaryContact(conversation) {
  if (!conversation || !conversation.contacts || !Array.isArray(conversation.contacts.contacts)) {
    return null;
  }

  return conversation.contacts.contacts[0] || null;
}

function stripHtml(value) {
  return (value || '').replace(/<[^>]*>/g, '').trim();
}

function renderMailboxList(conversations) {
  const listEl = document.getElementById('mailboxList');
  if (!listEl) {
    return;
  }

  listEl.innerHTML = '';

  for (const conversation of conversations) {
    const contact = extractPrimaryContact(conversation);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mailbox-item';

    if (conversation.id === selectedConversationId) {
      item.classList.add('active');
    }

    const title = document.createElement('strong');
    title.textContent = (contact && (contact.name || contact.email)) || 'Unknown contact';

    const preview = document.createElement('span');
    preview.textContent = stripHtml(conversation.source && conversation.source.body) || 'No message preview.';

    const meta = document.createElement('small');
    meta.textContent = `#${conversation.id} • ${formatDate(new Date((conversation.updated_at || conversation.created_at) * 1000).toISOString())}`;

    item.appendChild(title);
    item.appendChild(preview);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      selectedConversationId = conversation.id;
      renderMailboxList(conversations);
      loadConversationThread(conversation.id);
    });

    listEl.appendChild(item);
  }
}

function normalizeThreadMessages(conversation) {
  const messages = [];

  if (conversation && conversation.source) {
    messages.push({
      id: conversation.source.id || `source-${conversation.id}`,
      body: stripHtml(conversation.source.body),
      createdAt: conversation.created_at,
      author: conversation.source.author || {}
    });
  }

  const parts =
    conversation &&
    conversation.conversation_parts &&
    Array.isArray(conversation.conversation_parts.conversation_parts)
      ? conversation.conversation_parts.conversation_parts
      : [];

  for (const part of parts) {
    if (!part || !part.body) {
      continue;
    }

    messages.push({
      id: part.id,
      body: stripHtml(part.body),
      createdAt: part.created_at,
      author: part.author || {}
    });
  }

  return messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function renderConversationThread(conversation) {
  const headerEl = document.getElementById('mailboxThreadHeader');
  const threadEl = document.getElementById('messageThread');
  if (!headerEl || !threadEl) {
    return;
  }

  const contact = extractPrimaryContact(conversation);
  const title = (contact && (contact.name || contact.email)) || 'Unknown contact';
  headerEl.textContent = `Conversation #${conversation.id} • ${title}`;

  threadEl.innerHTML = '';
  const messages = normalizeThreadMessages(conversation);

  if (messages.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'status-text muted';
    empty.textContent = 'No messages yet.';
    threadEl.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const bubble = document.createElement('article');
    const isAdmin = message.author && message.author.type === 'admin';
    bubble.className = `thread-bubble ${isAdmin ? 'admin' : 'contact'}`;

    const meta = document.createElement('p');
    meta.className = 'thread-meta';
    const authorName = (message.author && (message.author.name || message.author.email)) || 'Unknown sender';
    meta.textContent = `${authorName} • ${formatDate(new Date((message.createdAt || 0) * 1000).toISOString())}`;

    const text = document.createElement('p');
    text.className = 'thread-text';
    text.textContent = message.body;

    bubble.appendChild(meta);
    bubble.appendChild(text);
    threadEl.appendChild(bubble);
  }
}

async function loadConversationThread(conversationId) {
  const statusEl = document.getElementById('conversationStatus');

  try {
    setStatus(statusEl, 'Loading conversation thread...');
    const response = await fetch(`/api/feedback/intercom/conversations/${conversationId}`);
    const result = await response.json();

    if (!response.ok) {
      setStatus(statusEl, result.error || 'Could not load conversation thread.', 'error');
      return;
    }

    renderConversationThread(result.conversation);
    setStatus(statusEl, 'Conversation thread loaded.', 'muted');
  } catch (error) {
    setStatus(statusEl, 'Could not load conversation thread.', 'error');
  }
}

async function loadIntercomConversations() {
  const listEl = document.getElementById('mailboxList');
  const statusEl = document.getElementById('conversationStatus');

  if (!listEl || !statusEl) {
    return;
  }

  listEl.innerHTML = '';
  setStatus(statusEl, 'Loading Intercom conversations...');

  try {
    const response = await fetch('/api/feedback/intercom/conversations?perPage=12');
    const result = await response.json();

    if (!response.ok) {
      setStatus(statusEl, result.error || 'Could not load Intercom conversations.', 'error');
      return;
    }

    const conversations = Array.isArray(result.conversations) ? result.conversations : [];

    if (conversations.length === 0) {
      setStatus(statusEl, 'No Intercom conversations found yet.', 'muted');
      return;
    }

    if (!selectedConversationId && conversations[0]) {
      selectedConversationId = conversations[0].id;
    }

    renderMailboxList(conversations);

    if (selectedConversationId) {
      await loadConversationThread(selectedConversationId);
    }

    setStatus(statusEl, `Loaded ${conversations.length} Intercom conversation(s).`, 'muted');
  } catch (error) {
    setStatus(statusEl, 'Could not load Intercom conversations.', 'error');
  }
}

function initAdminPanel() {
  if (adminPanelInitialized) {
    return;
  }

  adminPanelInitialized = true;
  loadIntercomStatus();
  loadFeedbackRecords();
  loadIntercomConversations();

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadFeedbackRecords);
  }

  const refreshConversationsBtn = document.getElementById('refreshConversationsBtn');
  if (refreshConversationsBtn) {
    refreshConversationsBtn.addEventListener('click', loadIntercomConversations);
  }

  const replyForm = document.getElementById('threadReplyForm');
  const replyInput = document.getElementById('threadReplyMessage');
  const replyBtn = document.getElementById('threadReplySendBtn');
  const replyStatus = document.getElementById('threadReplyStatus');

  if (replyForm && replyInput && replyBtn && replyStatus) {
    replyForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!selectedConversationId) {
        setStatus(replyStatus, 'Select a conversation first.', 'error');
        return;
      }

      const replyText = replyInput.value.trim();
      if (!replyText) {
        setStatus(replyStatus, 'Reply message is required.', 'error');
        return;
      }

      replyBtn.disabled = true;
      setStatus(replyStatus, 'Sending reply...');

      try {
        const response = await fetch(`/api/feedback/intercom/conversations/${selectedConversationId}/reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ message: replyText })
        });

        const result = await response.json();
        if (!response.ok) {
          setStatus(replyStatus, result.error || 'Failed to send reply.', 'error');
          return;
        }

        replyInput.value = '';
        setStatus(replyStatus, 'Reply sent successfully.', 'success');
        await loadIntercomConversations();
      } catch (error) {
        setStatus(replyStatus, 'Could not send reply. Please try again.', 'error');
      } finally {
        replyBtn.disabled = false;
      }
    });
  }
}

function setupAdminLoginWall() {
  const wall = document.getElementById('adminLoginWall');
  const content = document.getElementById('adminContent');
  const form = document.getElementById('adminLoginForm');
  const passwordInput = document.getElementById('adminPassword');
  const statusEl = document.getElementById('adminLoginStatus');

  if (!wall || !content || !form || !passwordInput || !statusEl) {
    initAdminPanel();
    return;
  }

  const unlock = () => {
    sessionStorage.setItem('rtfm_admin_unlocked', '1');
    wall.classList.add('hidden');
    content.classList.remove('hidden');
    initAdminPanel();
  };

  if (sessionStorage.getItem('rtfm_admin_unlocked') === '1') {
    unlock();
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    if (passwordInput.value === 'jenny') {
      setStatus(statusEl, 'Access granted.', 'success');
      unlock();
      return;
    }

    setStatus(statusEl, 'Incorrect password.', 'error');
  });
}

function initHomeMedia() {
  const audio = document.getElementById('landingAudio');
  const video = document.getElementById('landingVideo');
  const introGate = document.getElementById('introGate');
  const enterBtn = document.getElementById('jennyEnterBtn');
  const introStatus = document.getElementById('introStatus');

  if (!audio || !video || !enterBtn) {
    return;
  }

  let launched = false;
  video.muted = true;
  video.pause();
  audio.pause();
  video.currentTime = 0;
  audio.currentTime = 0;

  const revealHome = () => {
    document.body.classList.add('intro-complete');
    window.setTimeout(() => {
      if (introGate) {
        introGate.classList.add('hidden');
      }
    }, 920);
  };

  const startExperience = async () => {
    if (launched) {
      return;
    }

    launched = true;
    enterBtn.disabled = true;
    enterBtn.classList.add('loading');
    enterBtn.textContent = 'JENNY';

    if (introStatus) {
      introStatus.textContent = 'Downloading scene assets...';
    }

    await new Promise((resolve) => window.setTimeout(resolve, 500));

    if (introStatus) {
      introStatus.textContent = 'Verifying secure channel...';
    }

    await new Promise((resolve) => window.setTimeout(resolve, 650));

    if (introStatus) {
      introStatus.textContent = 'Launching JENNY experience...';
    }

    try {
      await video.play();
    } catch (error) {
      // Ignore playback errors caused by browser media constraints.
    }

    try {
      await audio.play();
    } catch (error) {
      // Ignore playback errors caused by browser media constraints.
    }

    revealHome();
  };

  enterBtn.addEventListener('click', startExperience);
}

function initPage() {
  const page = document.body.dataset.page;

  if (page === 'home') {
    initHomeMedia();
  }

  // The Intercom bubble should appear only on non-admin pages.
  if (page !== 'admin') {
    initIntercomMessenger();
  }

  if (page === 'feedback') {
    const form = document.getElementById('feedbackForm');
    if (form) {
      form.addEventListener('submit', submitFeedback);
    }
  }

  if (page === 'admin') {
    setupAdminLoginWall();
  }
}

document.addEventListener('DOMContentLoaded', initPage);
