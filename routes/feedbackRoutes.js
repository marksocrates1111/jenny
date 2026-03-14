const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  sendFeedbackToIntercom,
  getIntercomConfigStatus,
  listIntercomConversations,
  replyToIntercomConversation,
  getIntercomConversationDetail
} = require('../services/intercomService');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '..', 'data', 'feedback.json');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readFeedbackRecords() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeFeedbackRecords(records) {
  await fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
}

router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const message = (req.body.message || '').trim();

    if (!name || !email || !message) {
      return res.status(400).json({
        error: 'Name, email, and message are required.'
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        error: 'Please enter a valid email address.'
      });
    }

    const records = await readFeedbackRecords();

    const newRecord = {
      id: randomUUID(),
      name,
      email,
      message,
      status: 'new',
      createdAt: new Date().toISOString()
    };

    // Save locally first so we always keep a copy
    records.push(newRecord);
    await writeFeedbackRecords(records);

    // Then try to sync with Intercom
    const intercomResult = await sendFeedbackToIntercom(newRecord);

    if (intercomResult.sent) {
      newRecord.status = 'sent-to-intercom';
    } else if (intercomResult.skipped) {
      newRecord.status = 'saved-locally-only';
    } else {
      newRecord.status = 'intercom-failed';
      console.error('Intercom sync failed for feedback record:', {
        recordId: newRecord.id,
        email: newRecord.email,
        message: intercomResult.message,
        details: intercomResult.details || null
      });
    }

    await writeFeedbackRecords(records);

    return res.status(201).json({
      message: 'Feedback submitted successfully.',
      record: newRecord,
      intercom: intercomResult
    });
  } catch (error) {
    console.error('Error in POST /api/feedback:', error.message);
    return res.status(500).json({
      error: 'Something went wrong while submitting feedback.'
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const records = await readFeedbackRecords();

    // Show latest feedback first on admin page
    const sortedRecords = records.sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return res.json(sortedRecords);
  } catch (error) {
    console.error('Error in GET /api/feedback:', error.message);
    return res.status(500).json({
      error: 'Something went wrong while loading feedback.'
    });
  }
});

router.get('/intercom-status', (req, res) => {
  const status = getIntercomConfigStatus();
  return res.json(status);
});

router.get('/messenger-config', (req, res) => {
  const appId = (process.env.INTERCOM_APP_ID || '').trim();
  const apiBase = (process.env.INTERCOM_MESSENGER_API_BASE || 'https://api-iam.intercom.io').trim();
  const enabled = Boolean(appId) && !appId.toLowerCase().includes('your_intercom_app_id_here');

  return res.json({
    enabled,
    appId,
    apiBase
  });
});

router.get('/intercom/conversations', async (req, res) => {
  try {
    const perPage = Number.parseInt(req.query.perPage, 10) || 20;
    const result = await listIntercomConversations(perPage);

    if (!result.ok) {
      return res.status(502).json({
        error: result.message || 'Failed to load Intercom conversations.',
        details: result.details || null
      });
    }

    return res.json({
      conversations: result.conversations
    });
  } catch (error) {
    console.error('Error in GET /api/feedback/intercom/conversations:', error.message);
    return res.status(500).json({
      error: 'Something went wrong while loading Intercom conversations.'
    });
  }
});

router.post('/intercom/conversations/:conversationId/reply', async (req, res) => {
  try {
    const conversationId = (req.params.conversationId || '').trim();
    const message = (req.body.message || '').trim();

    if (!conversationId || !message) {
      return res.status(400).json({
        error: 'conversationId and message are required.'
      });
    }

    const result = await replyToIntercomConversation(conversationId, message);

    if (!result.ok) {
      return res.status(502).json({
        error: result.message || 'Failed to send Intercom reply.',
        details: result.details || null
      });
    }

    return res.json({
      message: result.message,
      data: result.data
    });
  } catch (error) {
    console.error('Error in POST /api/feedback/intercom/conversations/:conversationId/reply:', error.message);
    return res.status(500).json({
      error: 'Something went wrong while replying to Intercom conversation.'
    });
  }
});

router.get('/intercom/conversations/:conversationId', async (req, res) => {
  try {
    const conversationId = (req.params.conversationId || '').trim();

    if (!conversationId) {
      return res.status(400).json({
        error: 'conversationId is required.'
      });
    }

    const result = await getIntercomConversationDetail(conversationId);

    if (!result.ok) {
      return res.status(502).json({
        error: result.message || 'Failed to load Intercom conversation details.',
        details: result.details || null
      });
    }

    return res.json({
      conversation: result.conversation
    });
  } catch (error) {
    console.error('Error in GET /api/feedback/intercom/conversations/:conversationId:', error.message);
    return res.status(500).json({
      error: 'Something went wrong while loading Intercom conversation details.'
    });
  }
});

module.exports = router;
