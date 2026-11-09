
const app = document.querySelector('#app');

let me = null;
let current = 'home';

const SESSION_KEY = 'ask-aiham-session';

const $ = (selector, root = document) =>
  root.querySelector(selector);

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

let session = null;

try {
  session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
} catch {
  localStorage.removeItem(SESSION_KEY);
}

function saveSession(value) {
  session = value;

  if (value) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

function toast(message) {
  const element = $('#toast');
  if (!element) return;

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    element.classList.remove('show');
  }, 5000);
}

async function refreshSession() {
  if (!session?.refresh_token) {
    saveSession(null);
    return false;
  }

  try {
    const response = await fetch('/api/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: session.refresh_token
      })
    });

    const data = await response.json();

    if (!response.ok || !data.session?.access_token) {
      saveSession(null);
      return false;
    }

    saveSession(data.session);
    return true;
  } catch {
    return false;
  }
}

let refreshPromise = null;

async function refreshOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function api(path, options = {}, retry = true) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch('/api' + path, {
    ...options,
    headers,
    cache: 'no-store'
  });

  if (
    response.status === 401 &&
    retry &&
    session?.refresh_token &&
    path !== '/login' &&
    path !== '/register' &&
    path !== '/refresh'
  ) {
    const refreshed = await refreshOnce();

    if (refreshed) {
      return api(path, options, false);
    }
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

const post = (path, data, method = 'POST') =>
  api(path, {
    method,
    body: JSON.stringify(data)
  });

function syncNav() {
  $('#adminNav').hidden = !me?.admin;
  $('#mineNav').hidden = !me;
  $('#authNav').hidden = !!me;
  $('#logoutNav').hidden = !me;
}

async function refreshUser() {
  if (!session?.access_token) {
    me = null;
    syncNav();
    return null;
  }

  try {
    const result = await api('/me');
    me = result.user || null;

    if (!me && session?.refresh_token) {
      const refreshed = await refreshOnce();

      if (refreshed) {
        const retry = await api('/me');
        me = retry.user || null;
      }
    }
  } catch (error) {
    console.error('Could not load user:', error);
    me = null;
  }

  syncNav();
  return me;
}

function go(page) {
  current = page;

  const path = page === 'home' ? '/' : '/' + page;

  history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('popstate', () => {
  current = location.pathname.slice(1) || 'home';
  render();
});

document.querySelectorAll('[data-page]').forEach(button => {
  button.addEventListener('click', () => {
    go(button.dataset.page);
  });
});

$('#logoutNav').addEventListener('click', async () => {
  try {
    await post('/logout', {});
  } catch (error) {
    console.warn('Logout request failed:', error);
  }

  saveSession(null);
  me = null;

  syncNav();
  go('home');

  toast('Logged out!');
});

async function init() {
  await refreshUser();

  current = location.pathname.slice(1) || 'home';
  render();
}

function formHtml() {
  return `
    <div class="panel">
      <h2>SEND A QUESTION!</h2>

      <p class="subtle">
        No account needed. All questions are reviewed
        before they appear publicly.
      </p>

      <form id="askForm">
        ${me ? '' : `
          <label>YOUR NAME *</label>
          <input
            name="name"
            required
            maxlength="60"
            minlength="2"
            placeholder="What should I call you?"
          >
        `}

        <label>SUBJECT *</label>
        <input
          name="title"
          required
          minlength="4"
          maxlength="130"
          placeholder="What's the situation?"
        >

        <label>YOUR QUESTION *</label>
        <textarea
          name="body"
          required
          minlength="8"
          maxlength="4000"
          placeholder="Give me the details..."
        ></textarea>

        <label>WHO GETS TO SEE IT?</label>

        <div class="choice">
          <label>
            <input
              type="radio"
              name="visibility"
              value="public"
              checked
            >
            🌐 PUBLIC
          </label>

          <label>
            <input
              type="radio"
              name="visibility"
              value="private"
            >
            🔒 PRIVATE
          </label>
        </div>

        <p class="subtle">
          Public: visible after Aiham approves it.
          Private: only you and Aiham can read it.
          Guest access uses a secret link.
        </p>

        <div class="honeypot">
          <input
            name="website"
            tabindex="-1"
            autocomplete="off"
          >
        </div>

        <button class="action" type="submit">
          SEND CALLING CARD ↗
        </button>
      </form>
    </div>
  `;
}

function home() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">
          ★ THE UNOFFICIAL HELP DESK ★
        </div>

        <h1>ASK <span>AIHAM!</span></h1>

        <p class="lead">
          I left the store.<br>
          <strong>The questions followed me.</strong><br>
          Ask anything. I'll answer when I can.
        </p>

        <div class="stamp">
          NO QUESTION TOO WEIRD!
        </div>
      </div>

      ${formHtml()}
    </section>

    <div class="toolbar">
      <button id="browse">
        SEE ANSWERED QUESTIONS →
      </button>
    </div>
  `;

  $('#browse').onclick = () => go('archive');
  $('#askForm').onsubmit = submitQuestion;
}

async function submitQuestion(event) {
  event.preventDefault();

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const button = $('button[type=submit]', form);

  button.disabled = true;

  try {
    const result = await post('/questions', data);

    if (result.token) {
      const url =
        `${location.origin}/question/${result.id}` +
        `?token=${encodeURIComponent(result.token)}`;

      app.innerHTML = `
        <div class="container">
          <h1 class="page-title">
            CARD DELIVERED!
          </h1>

          <div class="panel">
            <h2>KEEP YOUR SECRET LINK</h2>

            <p>
              Save this link now. Without an account,
              it's the only way to revisit your question
              and reply to Aiham.
            </p>

            <div class="secret" id="secretUrl">
              ${esc(url)}
            </div>

            <button class="action" id="copy">
              COPY LINK
            </button>

            <p class="subtle">
              Anyone with this link can read this conversation.
              Don't share it if the question is private.
            </p>
          </div>
        </div>
      `;

      $('#copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast('Link copied!');
        } catch {
          toast('Copy the link manually.');
        }
      };

      return;
    }

    toast('Question submitted!');

    if (me) {
      go('mine');
    } else {
      go('home');
    }
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

async function archive() {
  app.innerHTML = `
    <h1 class="page-title">
      THE PUBLIC ARCHIVE
    </h1>

    <p class="muted">
      Loading calling cards...
    </p>
  `;

  try {
    const data = await api('/questions');

    app.innerHTML = `
      <h1 class="page-title">
        THE PUBLIC ARCHIVE
      </h1>

      <p class="muted">
        Answered and approved questions.
        Nothing private appears here.
      </p>

      <input
        class="search"
        id="search"
        placeholder="Search the archive..."
      >

      <div class="grid" id="cards"></div>
    `;

    const cards = $('#cards');

    function draw() {
      const term = $('#search').value.toLowerCase();

      const items = data.questions.filter(question =>
        [
          question.title,
          question.body,
          question.name
        ].join(' ').toLowerCase().includes(term)
      );

      cards.innerHTML = items.length
        ? items.map(question => `
          <article
            class="qcard"
            data-id="${question.id}"
          >
            <span class="tag">
              PUBLIC CALLING CARD #${question.id}
            </span>

            <h3>${esc(question.title)}</h3>

            <p>
              ${esc(question.body.slice(0, 160))}
            </p>

            <small>
              BY ${esc(question.name)} ·
              ${esc(question.created_at.slice(0, 10))}
            </small>
          </article>
        `).join('')
        : `
          <div class="empty">
            No questions found. Be the first!
          </div>
        `;

      cards.querySelectorAll('[data-id]').forEach(card => {
        card.onclick = () => {
          go('question/' + card.dataset.id);
        };
      });
    }

    $('#search').oninput = draw;
    draw();
  } catch (error) {
    app.innerHTML = `
      <div class="empty">
        ${esc(error.message)}
      </div>
    `;
  }
}

async function mine() {
  if (!me) {
    go('auth');
    return;
  }

  app.innerHTML = `
    <h1 class="page-title">
      MY QUESTIONS
    </h1>
  `;

  try {
    const { questions } = await api('/mine');

    app.innerHTML = `
      <h1 class="page-title">
        MY QUESTIONS
      </h1>

      <div class="grid">
        ${questions.length
          ? questions.map(question => `
            <article
              class="qcard"
              data-id="${question.id}"
            >
              <span class="tag">
                ${esc(question.visibility.toUpperCase())} ·
                ${esc(question.status.toUpperCase())}
              </span>

              <h3>${esc(question.title)}</h3>
            </article>
          `).join('')
          : `
            <div class="empty">
              No questions yet. Ask one!
            </div>
          `
        }
      </div>
    `;

    app.querySelectorAll('[data-id]').forEach(card => {
      card.onclick = () => {
        go('question/' + card.dataset.id);
      };
    });
  } catch (error) {
    toast(error.message);
  }
}

async function question() {
  const id = current.split('/')[1];

  const token =
    new URLSearchParams(location.search).get('token') || '';

  app.innerHTML = `
    <p>Loading conversation...</p>
  `;

  try {
    const result = await api(
      `/questions/${id}?token=${encodeURIComponent(token)}`
    );

    const q = result.question;
    const canReply = result.canReply;

    app.innerHTML = `
      <div class="container">
        <div class="eyebrow">
          ${esc(q.visibility.toUpperCase())}
          CALLING CARD #${q.id}
        </div>

        <h1 class="page-title">
          ${esc(q.title)}
        </h1>

        <div class="thread">
          <span class="tag">
            ${esc(q.name)}
          </span>

          <p>${esc(q.body)}</p>
        </div>

        <h2>THE CONVERSATION</h2>

        ${q.replies.map(reply => `
          <div class="thread ${
            reply.author === 'Aiham' ? 'aiham' : ''
          }">
            <strong>
              ${esc(reply.author)}
            </strong>

            <p>${esc(reply.body)}</p>

            <small>
              ${esc(reply.created_at)}
            </small>
          </div>
        `).join('') || `
          <p class="muted">
            Aiham hasn't replied yet.
            Check back soon.
          </p>
        `}

        ${canReply ? `
          <form id="replyForm" class="panel">
            <h2>YOUR REPLY</h2>

            <textarea
              name="body"
              required
              minlength="2"
              maxlength="4000"
              placeholder="Keep the conversation going..."
            ></textarea>

            <button class="action">
              SEND REPLY
            </button>
          </form>
        ` : ''}

        ${
          q.visibility === 'public' && !me?.admin
            ? `
              <p class="hint">
                Public follow-up replies appear
                after moderation.
              </p>
            `
            : ''
        }
      </div>
    `;

    if (canReply) {
      $('#replyForm').onsubmit = async event => {
        event.preventDefault();

        const form = event.target;
        const button = $('button', form);

        button.disabled = true;

        try {
          await post(`/questions/${id}/replies`, {
            body: form.elements.namedItem('body').value,
            token
          });

          toast('Reply sent!');
          render();
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        }
      };
    }
  } catch (error) {
    app.innerHTML = `
      <div class="empty">
        ${esc(error.message)}

        <p>
          For private guest questions,
          open your original secret link.
        </p>
      </div>
    `;
  }
}

function auth() {
  app.innerHTML = `
    <div class="authbox">
      <h1 class="page-title">
        JOIN THE CREW
      </h1>

      <div class="panel">
        <h2 id="authTitle">
          LOG IN
        </h2>

        <form id="authForm">
          <div id="nameField" hidden>
            <label>DISPLAY NAME</label>

            <input
              name="name"
              placeholder="Your name"
            >
          </div>

          <label>EMAIL</label>

          <input
            type="email"
            name="email"
            required
          >

          <label>PASSWORD</label>

          <input
            type="password"
            name="password"
            required
            minlength="10"
          >

          <button class="action" type="submit">
            LET ME IN ↗
          </button>
        </form>

        <p>
          <button id="toggleAuth" type="button">
            Create an account instead
          </button>
        </p>

        <p class="subtle">
          Accounts are optional.
          They save your name and let you track
          questions across devices.
        </p>
      </div>
    </div>
  `;

  let register = false;

  $('#toggleAuth').onclick = () => {
    register = !register;

    $('#authTitle').textContent =
      register ? 'CREATE ACCOUNT' : 'LOG IN';

    $('#nameField').hidden = !register;

    $('#nameField input').required = register;

    $('#toggleAuth').textContent = register
      ? 'Already registered? Log in'
      : 'Create an account instead';
  };

  $('#authForm').onsubmit = async event => {
    event.preventDefault();

    const form = event.target;
    const button = $('button[type=submit]', form);

    const data = Object.fromEntries(new FormData(form));

    button.disabled = true;

    try {
      const result = await post(
        register ? '/register' : '/login',
        data
      );

      if (result.session?.access_token) {
        saveSession(result.session);
      } else {
        if (register && result.needsConfirmation) {
          toast(
            'Account created! Check your email to confirm it, then log in.'
          );
        } else {
          toast(
            'No login session was returned. Please try logging in.'
          );
        }

        button.disabled = false;
        return;
      }

      await refreshUser();

      if (!me) {
        toast(
          'Login succeeded, but your profile could not be loaded.'
        );

        button.disabled = false;
        return;
      }

      go(me.admin ? 'admin' : 'mine');

      toast(`Welcome, ${me.name}!`);
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  };
}

async function admin() {
  if (!me?.admin) {
    go('auth');
    return;
  }

  app.innerHTML = `
    <h1 class="page-title">
      AIHAM'S INBOX
    </h1>

    <p>Loading...</p>
  `;

  try {
    const { questions, pendingReplies } =
      await api('/admin/questions');

    const pendingCount =
      questions.filter(q => q.status === 'pending').length;

    app.innerHTML = `
      <h1 class="page-title">
        AIHAM'S INBOX
      </h1>

      <p class="muted">
        ${pendingCount} questions awaiting review ·
        ${pendingReplies.length}
        public replies awaiting approval
      </p>

      <h2>QUESTIONS</h2>

      <div class="grid">
        ${questions.map(q => `
          <article class="qcard">
            <span class="tag">
              #${q.id} ·
              ${esc(q.visibility)} ·
              ${esc(q.status)}
            </span>

            <h3>${esc(q.title)}</h3>

            <p>${esc(q.body.slice(0, 220))}</p>

            <small>${esc(q.name)}</small>

            <div class="toolbar">
              <button data-open="${q.id}">
                OPEN
              </button>

              ${q.visibility === 'public' ? `
                <button
                  data-status="published"
                  data-id="${q.id}"
                >
                  PUBLISH
                </button>
              ` : ''}

              <button
                data-status="hidden"
                data-id="${q.id}"
              >
                HIDE
              </button>

              <button
                class="danger"
                data-delete="${q.id}"
              >
                DELETE
              </button>
            </div>
          </article>
        `).join('')}
      </div>

      <h2>REPLIES TO MODERATE</h2>

      <div class="grid">
        ${pendingReplies.map(reply => `
          <article class="qcard">
            <span class="tag">
              ON QUESTION #${reply.question_id}
            </span>

            <p>${esc(reply.body)}</p>

            <small>${esc(reply.author)}</small>

            <div class="toolbar">
              <button data-approve="${reply.id}">
                APPROVE
              </button>

              <button
                class="danger"
                data-delreply="${reply.id}"
              >
                DELETE
              </button>
            </div>
          </article>
        `).join('') || `
          <div class="empty">
            All caught up!
          </div>
        `}
      </div>
    `;

    app.querySelectorAll('[data-open]').forEach(button => {
      button.onclick = () => {
        go('question/' + button.dataset.open);
      };
    });

    app.querySelectorAll('[data-status]').forEach(button => {
      button.onclick = async () => {
        try {
          await post(
            '/admin/questions/' + button.dataset.id,
            { status: button.dataset.status },
            'PATCH'
          );

          admin();
        } catch (error) {
          toast(error.message);
        }
      };
    });

    app.querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = async () => {
        if (!confirm('Permanently delete this question?')) {
          return;
        }

        try {
          await api(
            '/admin/questions/' + button.dataset.delete,
            { method: 'DELETE' }
          );

          admin();
        } catch (error) {
          toast(error.message);
        }
      };
    });

    app.querySelectorAll('[data-approve]').forEach(button => {
      button.onclick = async () => {
        try {
          await post(
            '/admin/replies/' + button.dataset.approve,
            { approved: true },
            'PATCH'
          );

          admin();
        } catch (error) {
          toast(error.message);
        }
      };
    });

    app.querySelectorAll('[data-delreply]').forEach(button => {
      button.onclick = async () => {
        try {
          await api(
            '/admin/replies/' + button.dataset.delreply,
            { method: 'DELETE' }
          );

          admin();
        } catch (error) {
          toast(error.message);
        }
      };
    });
  } catch (error) {
    toast(error.message);
  }
}

function render() {
  syncNav();

  if (current === 'home') {
    home();
  } else if (current === 'archive') {
    archive();
  } else if (current === 'mine') {
    mine();
  } else if (current === 'auth') {
    auth();
  } else if (current === 'admin') {
    admin();
  } else if (current.startsWith('question/')) {
    question();
  } else {
    go('home');
  }
}

init();
