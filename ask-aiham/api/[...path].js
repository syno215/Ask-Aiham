
import { createClient } from '@supabase/supabase-js';
import {
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const configured = Boolean(
  SUPABASE_URL &&
  PUBLISHABLE_KEY &&
  SECRET_KEY
);

function makeClient(key) {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

const hash = value =>
  createHash('sha256')
    .update(value)
    .digest('hex');

const clean = (value, max = 4000) =>
  typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function unwrap(result) {
  if (result.error) {
    throw result.error;
  }
  return result.data;
}

function matchesToken(token, storedHash) {
  if (!token || !storedHash) return false;

  const a = Buffer.from(hash(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

function getPath(req) {
  const pathname = new URL(
    req.url,
    'https://localhost'
  ).pathname;

  return (
    pathname
      .replace(/^\/api(?=\/|$)/, '')
      .replace(/\/+$/, '') || '/'
  );
}

function getBody(req) {
  if (!req.body) return {};

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

function getToken(req) {
  const authorization = req.headers.authorization || '';

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : '';
}

function validEmail(email) {
  return (
    email.length <= 160 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function sessionResponse(session) {
  if (!session) return null;

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (!configured) {
    return sendError(
      res,
      503,
      'Server not configured. Check Vercel environment variables.'
    );
  }

  const path = getPath(req);
  const method = req.method;
  const body = getBody(req);
  const token = getToken(req);

  try {
    const sb = makeClient(SECRET_KEY);
    const authClient = makeClient(PUBLISHABLE_KEY);

    let user = null;
    let profile = null;
    let isAdmin = false;

    // AUTHENTICATE REQUEST

    if (token) {
      const { data, error } =
        await authClient.auth.getUser(token);

      if (!error && data?.user) {
        user = data.user;

        profile = unwrap(
          await sb
            .from('profiles')
            .select('display_name')
            .eq('id', user.id)
            .maybeSingle()
        );

        const adminRecord = unwrap(
          await sb
            .from('admins')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle()
        );

        isAdmin = Boolean(adminRecord);
      }
    }

    const me = user
      ? {
          id: user.id,
          name:
            profile?.display_name ||
            user.user_metadata?.display_name ||
            user.email,
          email: user.email,
          admin: isAdmin
        }
      : null;

    // CURRENT USER

    if (path === '/me' && method === 'GET') {
      return res.json({ user: me });
    }

    // REGISTER

    if (path === '/register' && method === 'POST') {
      const name = clean(body.name, 60);
      const email = clean(body.email, 160).toLowerCase();
      const password = body.password;

      if (
        name.length < 2 ||
        !validEmail(email) ||
        typeof password !== 'string' ||
        password.length < 10
      ) {
        return sendError(
          res,
          400,
          'Enter a valid name, email, and password of at least 10 characters.'
        );
      }

      const { data, error } =
        await authClient.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: name
            }
          }
        });

      if (error) {
        return sendError(res, 400, error.message);
      }

      if (data.user && data.session) {
        unwrap(
          await sb
            .from('profiles')
            .upsert({
              id: data.user.id,
              display_name: name
            })
        );
      }

      return res.json({
        ok: true,
        needsConfirmation: !data.session,
        session: sessionResponse(data.session)
      });
    }

    // LOGIN

    if (path === '/login' && method === 'POST') {
      const email = clean(body.email, 160).toLowerCase();
      const password = body.password || '';

      const { data, error } =
        await authClient.auth.signInWithPassword({
          email,
          password
        });

      if (error) {
        return sendError(res, 401, error.message);
      }

      if (!data.session) {
        return sendError(
          res,
          401,
          'No session returned. Check email confirmation.'
        );
      }

      return res.json({
        ok: true,
        session: sessionResponse(data.session)
      });
    }

    // REFRESH LOGIN SESSION

    if (path === '/refresh' && method === 'POST') {
      if (!body.refresh_token) {
        return sendError(
          res,
          400,
          'Missing refresh token.'
        );
      }

      const { data, error } =
        await authClient.auth.refreshSession({
          refresh_token: body.refresh_token
        });

      if (error || !data.session) {
        return sendError(
          res,
          401,
          error?.message || 'Session expired.'
        );
      }

      return res.json({
        ok: true,
        session: sessionResponse(data.session)
      });
    }

    // LOGOUT
    // The frontend clears its stored tokens.

    if (path === '/logout' && method === 'POST') {
      return res.json({ ok: true });
    }

    // CREATE QUESTION

    if (path === '/questions' && method === 'POST') {
      if (body.website) {
        return res.json({ ok: true });
      }

      const title = clean(body.title, 130);
      const content = clean(body.body, 4000);
      const visibility =
        body.visibility === 'private'
          ? 'private'
          : 'public';

      const name = me?.name || clean(body.name, 60);

      if (
        title.length < 4 ||
        content.length < 8 ||
        name.length < 2
      ) {
        return sendError(
          res,
          400,
          'Name, title, and question are required.'
        );
      }

      const guestToken = user
        ? null
        : randomBytes(32).toString('base64url');

      const question = unwrap(
        await sb
          .from('questions')
          .insert({
            user_id: user?.id || null,
            guest_token_hash: guestToken
              ? hash(guestToken)
              : null,
            name,
            title,
            body: content,
            visibility,
            status: 'pending'
          })
          .select('id')
          .single()
      );

      return res.json({
        id: question.id,
        token: guestToken,
        visibility
      });
    }

    // PUBLIC ARCHIVE

    if (path === '/questions' && method === 'GET') {
      const questions = unwrap(
        await sb
          .from('questions')
          .select(
            'id,title,body,name,visibility,status,created_at'
          )
          .eq('visibility', 'public')
          .eq('status', 'published')
          .order('id', { ascending: false })
          .limit(100)
      );

      return res.json({ questions });
    }

    // MY QUESTIONS

    if (path === '/mine' && method === 'GET') {
      if (!user) {
        return sendError(res, 401, 'Log in first.');
      }

      const questions = unwrap(
        await sb
          .from('questions')
          .select(
            'id,title,visibility,status,created_at'
          )
          .eq('user_id', user.id)
          .order('id', { ascending: false })
      );

      return res.json({ questions });
    }

    // ADMIN INBOX

    if (
      path === '/admin/questions' &&
      method === 'GET'
    ) {
      if (!isAdmin) {
        return sendError(res, 403, 'Admin only.');
      }

      const questions = unwrap(
        await sb
          .from('questions')
          .select(
            'id,title,body,name,visibility,status,created_at'
          )
          .order('id', { ascending: false })
          .limit(300)
      );

      const pendingReplies = unwrap(
        await sb
          .from('replies')
          .select(
            'id,question_id,body,author:author_name,questions!inner(visibility)'
          )
          .eq('approved', false)
          .eq('questions.visibility', 'public')
          .order('id', { ascending: false })
      );

      return res.json({
        questions,
        pendingReplies
      });
    }

    // VIEW SINGLE QUESTION

    const questionMatch =
      path.match(/^\/questions\/(\d+)$/);

    if (questionMatch && method === 'GET') {
      const question = unwrap(
        await sb
          .from('questions')
          .select('*')
          .eq('id', questionMatch[1])
          .maybeSingle()
      );

      if (!question) {
        return sendError(
          res,
          404,
          'Question not found.'
        );
      }

      const query = new URL(
        req.url,
        'https://localhost'
      );

      const guestToken = clean(
        query.searchParams.get('token'),
        200
      );

      const owner = Boolean(
        isAdmin ||
        (user && question.user_id === user.id) ||
        matchesToken(
          guestToken,
          question.guest_token_hash
        )
      );

      const publiclyVisible =
        question.visibility === 'public' &&
        question.status === 'published';

      if (!owner && !publiclyVisible) {
        return sendError(
          res,
          404,
          'Question not found or access denied.'
        );
      }

      let replies = unwrap(
        await sb
          .from('replies')
          .select(
            'id,body,author:author_name,created_at,approved'
          )
          .eq('question_id', question.id)
          .order('id', { ascending: true })
      );

      if (!owner || !isAdmin) {
        replies = replies.filter(
          reply => reply.approved
        );
      }

      const {
        guest_token_hash,
        user_id,
        ...safeQuestion
      } = question;

      return res.json({
        question: {
          ...safeQuestion,
          replies: replies.map(
            ({ approved, ...reply }) => reply
          )
        },
        canReply: owner
      });
    }

    // REPLY TO QUESTION

    const replyMatch =
      path.match(/^\/questions\/(\d+)\/replies$/);

    if (replyMatch && method === 'POST') {
      const question = unwrap(
        await sb
          .from('questions')
          .select('*')
          .eq('id', replyMatch[1])
          .maybeSingle()
      );

      if (!question) {
        return sendError(
          res,
          404,
          'Question not found.'
        );
      }

      const allowed = Boolean(
        isAdmin ||
        (user && question.user_id === user.id) ||
        matchesToken(
          clean(body.token, 200),
          question.guest_token_hash
        )
      );

      if (!allowed) {
        return sendError(
          res,
          403,
          'Not authorized to reply.'
        );
      }

      const content = clean(body.body, 4000);

      if (content.length < 2) {
        return sendError(
          res,
          400,
          'Reply is too short.'
        );
      }

      unwrap(
        await sb
          .from('replies')
          .insert({
            question_id: question.id,
            body: content,
            author_id: user?.id || null,
            author_name: isAdmin
              ? 'Aiham'
              : question.name,
            approved: isAdmin
          })
      );

      return res.json({ ok: true });
    }

    // ADMIN QUESTION ACTIONS

    const adminQuestionMatch =
      path.match(/^\/admin\/questions\/(\d+)$/);

    if (adminQuestionMatch && method === 'PATCH') {
      if (!isAdmin) {
        return sendError(res, 403, 'Admin only.');
      }

      const question = unwrap(
        await sb
          .from('questions')
          .select('visibility')
          .eq('id', adminQuestionMatch[1])
          .maybeSingle()
      );

      if (!question) {
        return sendError(
          res,
          404,
          'Question not found.'
        );
      }

      const status = body.status;

      if (
        !['pending', 'published', 'hidden'].includes(status) ||
        (
          question.visibility === 'private' &&
          status === 'published'
        )
      ) {
        return sendError(
          res,
          400,
          'Invalid question status.'
        );
      }

      unwrap(
        await sb
          .from('questions')
          .update({ status })
          .eq('id', adminQuestionMatch[1])
      );

      return res.json({ ok: true });
    }

    if (adminQuestionMatch && method === 'DELETE') {
      if (!isAdmin) {
        return sendError(res, 403, 'Admin only.');
      }

      unwrap(
        await sb
          .from('questions')
          .delete()
          .eq('id', adminQuestionMatch[1])
      );

      return res.json({ ok: true });
    }

    // ADMIN REPLY MODERATION

    const adminReplyMatch =
      path.match(/^\/admin\/replies\/(\d+)$/);

    if (adminReplyMatch && method === 'PATCH') {
      if (!isAdmin) {
        return sendError(res, 403, 'Admin only.');
      }

      const reply = unwrap(
        await sb
          .from('replies')
          .select('question_id')
          .eq('id', adminReplyMatch[1])
          .maybeSingle()
      );

      if (!reply) {
        return sendError(
          res,
          404,
          'Reply not found.'
        );
      }

      const question = unwrap(
        await sb
          .from('questions')
          .select('visibility')
          .eq('id', reply.question_id)
          .single()
      );

      if (question.visibility !== 'public') {
        return sendError(
          res,
          400,
          'Only public replies can be moderated.'
        );
      }

      unwrap(
        await sb
          .from('replies')
          .update({
            approved: body.approved === true
          })
          .eq('id', adminReplyMatch[1])
      );

      return res.json({ ok: true });
    }

    if (adminReplyMatch && method === 'DELETE') {
      if (!isAdmin) {
        return sendError(res, 403, 'Admin only.');
      }

      unwrap(
        await sb
          .from('replies')
          .delete()
          .eq('id', adminReplyMatch[1])
      );

      return res.json({ ok: true });
    }

    return sendError(res, 404, 'Not found.');

  } catch (error) {
    console.error('API error:', {
      message: error?.message,
      code: error?.code,
      cause: error?.cause?.message
    });

    return sendError(
      res,
      500,
      'Server error. Check Vercel logs.'
    );
  }
}
