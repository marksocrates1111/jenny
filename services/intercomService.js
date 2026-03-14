const BASE_URL = (process.env.INTERCOM_BASE_URL || 'https://api.intercom.io').replace(/\/$/, '');
const ACCESS_TOKEN = (process.env.INTERCOM_ACCESS_TOKEN || '').trim();
let cachedAdminId = null;
const REQUEST_TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryResponse(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function shouldRetryError(error) {
  const message = (error && error.message ? error.message : '').toLowerCase();
  return message.includes('abort') || message.includes('timeout') || message.includes('network');
}

function hasUsableToken() {
  if (!ACCESS_TOKEN) {
    return false;
  }

  return !ACCESS_TOKEN.toLowerCase().includes('your_intercom_access_token_here');
}

function getIntercomConfigStatus() {
  if (!hasUsableToken()) {
    return {
      configured: false,
      message: 'Intercom token is missing or still set to placeholder text.'
    };
  }

  return {
    configured: true,
    message: 'Intercom token is configured.'
  };
}

async function intercomRequest(endpoint, method = 'POST', body = null) {
  if (!hasUsableToken()) {
    return {
      ok: false,
      skipped: true,
      message: 'INTERCOM_ACCESS_TOKEN is missing or still a placeholder.'
    };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': '2.11'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutHandle);
  }

  const raw = await response.text();
  let data;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    data = { raw };
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data
  };
}

async function intercomRequestWithRetry(endpoint, method = 'POST', body = null, maxAttempts = 3) {
  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await intercomRequest(endpoint, method, body);
      lastResult = result;

      if (result.ok || !shouldRetryResponse(result.status) || attempt === maxAttempts) {
        return result;
      }
    } catch (error) {
      lastError = error;
      if (!shouldRetryError(error) || attempt === maxAttempts) {
        throw error;
      }
    }

    const backoffMs = 250 * attempt;
    await sleep(backoffMs);
  }

  if (lastError) {
    throw lastError;
  }

  return (
    lastResult || {
      ok: false,
      status: 0,
      statusText: 'Unknown retry failure',
      data: {}
    }
  );
}

async function findOrCreateContact(name, email) {
  const searchPayload = {
    query: {
      operator: 'AND',
      value: [
        {
          field: 'email',
          operator: '=',
          value: email
        }
      ]
    }
  };

  const normalizedEmail = email.toLowerCase();
  searchPayload.query.value[0].value = normalizedEmail;

  const searchResult = await intercomRequestWithRetry('/contacts/search', 'POST', searchPayload);

  if (searchResult.ok && searchResult.data && Array.isArray(searchResult.data.data)) {
    const existingContact = searchResult.data.data.find((contact) => contact && contact.id);
    if (existingContact && existingContact.id) {
      return {
        id: existingContact.id,
        role: existingContact.role || 'contact'
      };
    }
  }

  const roleCandidates = ['user', 'lead'];
  const createAttempts = [];

  for (const role of roleCandidates) {
    const createPayload = {
      role,
      email: normalizedEmail,
      name
    };

    const createResult = await intercomRequestWithRetry('/contacts', 'POST', createPayload);
    createAttempts.push({ role, status: createResult.status, ok: createResult.ok, error: createResult.ok ? null : createResult.data });

    if (createResult.ok && createResult.data && createResult.data.id) {
      // Give Intercom a brief moment to index a newly created contact for conversation creation.
      await sleep(250);
      return {
        id: createResult.data.id,
        role: createResult.data.role || role || 'contact'
      };
    }
  }

  throw new Error(
    `Could not find or create Intercom contact. Search status: ${searchResult.status || 'n/a'}; create attempts: ${JSON.stringify(createAttempts)}`
  );
}

function buildConversationBody(record) {
  return `Feedback message:\n${record.message}\n\nFrom: ${record.name} (${record.email})`;
}

async function createConversationWithFallbacks(contactId, contactRole, record) {
  const normalizedRole = (contactRole || 'contact').toLowerCase();
  const roleCandidates = [];

  if (normalizedRole === 'user' || normalizedRole === 'lead') {
    roleCandidates.push(normalizedRole);
  }

  // Keep all supported sender types as fallback. Different workspaces can behave differently.
  roleCandidates.push('contact', 'user', 'lead');

  const uniqueCandidates = [...new Set(roleCandidates)];
  const attempts = [];

  const messageTypeCandidates = ['inapp', 'email'];

  for (const senderType of uniqueCandidates) {
    for (const messageType of messageTypeCandidates) {
      const payload = {
        from: {
          type: senderType,
          id: contactId
        },
        body: buildConversationBody(record),
        message_type: messageType
      };

      const result = await intercomRequestWithRetry('/conversations', 'POST', payload);

      attempts.push({
        senderType,
        messageType,
        status: result.status,
        ok: result.ok,
        error: result.ok ? null : result.data
      });

      if (result.ok) {
        return {
          ok: true,
          result,
          attempts
        };
      }
    }
  }

  return {
    ok: false,
    attempts
  };
}

async function createIntercomNoteFallback(contactId, record) {
  try {
    const adminId = await getCurrentAdminId();
    const payload = {
      body: buildConversationBody(record),
      admin_id: adminId
    };

    const noteResult = await intercomRequestWithRetry(`/contacts/${contactId}/notes`, 'POST', payload);

    if (!noteResult.ok) {
      return {
        ok: false,
        details: noteResult.data
      };
    }

    return {
      ok: true,
      noteId: noteResult.data && noteResult.data.id
    };
  } catch (error) {
    return {
      ok: false,
      details: error.message
    };
  }
}

async function sendFeedbackToIntercom(record) {
  if (!hasUsableToken()) {
    return {
      sent: false,
      skipped: true,
      message: 'Feedback saved locally. Add a real INTERCOM_ACCESS_TOKEN in .env.'
    };
  }

  try {
    const contact = await findOrCreateContact(record.name, record.email);
    const conversationAttempt = await createConversationWithFallbacks(contact.id, contact.role, record);

    if (!conversationAttempt.ok) {
      const lastAttempt = conversationAttempt.attempts[conversationAttempt.attempts.length - 1];

      const noteFallback = await createIntercomNoteFallback(contact.id, record);
      if (noteFallback.ok) {
        return {
          sent: true,
          skipped: false,
          message: 'Feedback saved to Intercom as a contact note.',
          contact,
          noteId: noteFallback.noteId
        };
      }

      return {
        sent: false,
        skipped: false,
        message: `Intercom conversation request failed (${lastAttempt ? lastAttempt.status : 'unknown'}).`,
        details: {
          contact,
          attempts: conversationAttempt.attempts,
          noteFallback: noteFallback.details || null
        }
      };
    }

    const conversationResult = conversationAttempt.result;

    return {
      sent: true,
      skipped: false,
      message: 'Feedback sent to Intercom successfully.',
      conversationId: conversationResult.data && (conversationResult.data.conversation_id || conversationResult.data.id),
      contact,
      senderTypeUsed: conversationAttempt.attempts[conversationAttempt.attempts.length - 1].senderType
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      message: 'Error while sending to Intercom.',
      details: error.message
    };
  }
}

async function getCurrentAdminId() {
  if (cachedAdminId) {
    return cachedAdminId;
  }

  const meResult = await intercomRequestWithRetry('/me', 'GET');

  if (!meResult.ok || !meResult.data || !meResult.data.id) {
    throw new Error('Could not fetch current Intercom admin id.');
  }

  cachedAdminId = meResult.data.id;
  return cachedAdminId;
}

async function listIntercomConversations(perPage = 20) {
  if (!hasUsableToken()) {
    return {
      ok: false,
      skipped: true,
      message: 'Intercom token is missing or invalid.'
    };
  }

  const safePerPage = Number.isFinite(perPage) ? Math.min(Math.max(perPage, 1), 50) : 20;
  const result = await intercomRequestWithRetry(`/conversations?per_page=${safePerPage}`, 'GET');

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: 'Failed to load Intercom conversations.',
      details: result.data
    };
  }

  return {
    ok: true,
    conversations: Array.isArray(result.data.conversations) ? result.data.conversations : []
  };
}

async function replyToIntercomConversation(conversationId, body) {
  if (!hasUsableToken()) {
    return {
      ok: false,
      skipped: true,
      message: 'Intercom token is missing or invalid.'
    };
  }

  const adminId = await getCurrentAdminId();
  const payload = {
    message_type: 'comment',
    type: 'admin',
    admin_id: adminId,
    body
  };

  const result = await intercomRequestWithRetry(`/conversations/${conversationId}/reply`, 'POST', payload);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: 'Failed to send Intercom reply.',
      details: result.data
    };
  }

  return {
    ok: true,
    message: 'Reply sent to Intercom conversation.',
    data: result.data
  };
}

async function getIntercomConversationDetail(conversationId) {
  if (!hasUsableToken()) {
    return {
      ok: false,
      skipped: true,
      message: 'Intercom token is missing or invalid.'
    };
  }

  const result = await intercomRequestWithRetry(`/conversations/${conversationId}`, 'GET');

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      message: 'Failed to load Intercom conversation details.',
      details: result.data
    };
  }

  return {
    ok: true,
    conversation: result.data
  };
}

module.exports = {
  sendFeedbackToIntercom,
  getIntercomConfigStatus,
  listIntercomConversations,
  replyToIntercomConversation,
  getIntercomConversationDetail
};
