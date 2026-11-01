/**
 * 5.0.63 — l'appli web du téléphone, servie par `server.ts`. Trois fichiers statiques, sans
 * bibliothèque ni CDN (la politique de sécurité de la page n'autorise que ce serveur). Le texte du
 * modèle est toujours affiché par `textContent`, jamais comme du HTML.
 *
 * Chaque fichier est un `String.raw` : pas d'accent grave ni de « dollar accolade » à l'intérieur
 * (les expressions régulières utilisent \x60 pour l'accent grave).
 */

export const PHONE_HTML = String.raw`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Jarvis">
<meta name="theme-color" content="#05080d">
<meta name="referrer" content="no-referrer">
<title>Jarvis</title>
<link rel="apple-touch-icon" href="/icon.png">
<link rel="icon" href="/icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>
<main id="view-pair" class="pair" hidden>
  <div class="orb" aria-hidden="true"></div>
  <h1>Jarvis</h1>
  <p class="lead">Relie ce téléphone à Jarvis sur ton PC.</p>
  <section id="install" class="install" hidden>
    <p><strong>Pour l’avoir comme une appli :</strong></p>
    <ol>
      <li>Touche <strong>Partager</strong> (le carré avec la flèche), puis <strong>Sur l’écran d’accueil</strong>.</li>
      <li>Ouvre <strong>Jarvis</strong> depuis la nouvelle icône.</li>
      <li>Tape ce code : <span id="install-code" class="code"></span></li>
    </ol>
    <button id="use-here" type="button" class="ghost">Ou l’utiliser ici, dans Safari</button>
  </section>
  <form id="pair-form" class="pair-form" autocomplete="off">
    <label for="code">Code affiché sur le PC (Réglages → Téléphone)</label>
    <input id="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="123456" autocomplete="one-time-code">
    <button id="pair-button" type="submit">Relier</button>
    <p id="pair-error" class="error-text" role="alert"></p>
  </form>
</main>
<main id="view-chat" class="chat" hidden>
  <header>
    <div class="title">
      <div class="dot" aria-hidden="true"></div>
      <div>
        <h1>Jarvis</h1>
        <p id="status" class="status">Connexion…</p>
      </div>
    </div>
    <div class="header-actions">
      <button id="speak" type="button" class="icon" aria-label="Lecture des réponses">🔊</button>
      <button id="new" type="button" class="icon" aria-label="Nouvelle discussion">＋</button>
    </div>
  </header>
  <div id="messages" class="messages" aria-live="polite"></div>
  <p id="tip" class="tip" hidden>Astuce : le micro du clavier permet de dicter.</p>
  <form id="composer" class="composer" autocomplete="off">
    <button id="mic" type="button" class="icon mic" aria-label="Parler">🎤</button>
    <textarea id="input" rows="1" placeholder="Demande à Jarvis…" enterkeyhint="send"></textarea>
    <button id="send" type="submit" class="send" aria-label="Envoyer">➤</button>
  </form>
</main>
</body>
</html>
`;

export const PHONE_CSS = String.raw`:root {
  color-scheme: dark;
  --bg: #05080d;
  --panel: #0c131c;
  --line: rgba(255, 255, 255, 0.08);
  --text: #e6edf5;
  --muted: #8a97a8;
  --accent: #38d9f5;
  --accent-soft: rgba(56, 217, 245, 0.14);
  --danger: #fb7185;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; overscroll-behavior: none; }
[hidden] { display: none !important; }
button { font: inherit; border: 0; border-radius: 12px; padding: 12px 16px; background: var(--accent); color: #031018; font-weight: 600; cursor: pointer; }
button:disabled { opacity: 0.5; }
button.ghost { background: transparent; color: var(--accent); border: 1px solid rgba(56, 217, 245, 0.35); }
button.icon { background: transparent; color: var(--text); padding: 8px 10px; font-size: 20px; line-height: 1; }

.pair { min-height: 100%; padding: calc(env(safe-area-inset-top) + 48px) 24px calc(env(safe-area-inset-bottom) + 24px); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; }
.orb { width: 96px; height: 96px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #b8f4ff, var(--accent) 35%, #0b3a4a 75%); box-shadow: 0 0 48px rgba(56, 217, 245, 0.45); }
.pair h1 { margin: 8px 0 0; font-size: 30px; letter-spacing: 0.04em; }
.lead { margin: 0; color: var(--muted); }
.install { width: 100%; max-width: 420px; text-align: left; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 16px; }
.install ol { padding-left: 20px; margin: 8px 0 12px; }
.install li { margin: 6px 0; }
.install button { width: 100%; }
.code { font: 600 22px/1.2 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.18em; color: var(--accent); }
.pair-form { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.pair-form label { color: var(--muted); font-size: 14px; }
.pair-form input { font: 600 26px/1.2 ui-monospace, "SF Mono", Menlo, monospace; text-align: center; letter-spacing: 0.3em; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel); color: var(--text); outline: none; }
.pair-form input:focus { border-color: var(--accent); }
.error-text { color: var(--danger); min-height: 1.4em; margin: 0; font-size: 14px; }

.chat { height: 100%; display: flex; flex-direction: column; }
header { display: flex; align-items: center; justify-content: space-between; padding: calc(env(safe-area-inset-top) + 8px) 12px 8px 16px; border-bottom: 1px solid var(--line); background: rgba(5, 8, 13, 0.92); }
.title { display: flex; align-items: center; gap: 10px; }
.title h1 { margin: 0; font-size: 18px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
.status { margin: 0; font-size: 12px; color: var(--muted); }
.status.bad { color: var(--danger); }
.header-actions { display: flex; gap: 2px; }
.messages { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 12px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 86%; padding: 10px 14px; border-radius: 18px; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: var(--accent); color: #031018; border-bottom-right-radius: 6px; }
.msg.assistant { align-self: flex-start; background: var(--panel); border: 1px solid var(--line); border-bottom-left-radius: 6px; }
.msg.note { align-self: flex-start; font-size: 12px; color: var(--muted); background: var(--accent-soft); padding: 4px 10px; border-radius: 999px; }
.msg.error { align-self: stretch; max-width: 100%; color: var(--danger); background: rgba(251, 113, 133, 0.08); border: 1px solid rgba(251, 113, 133, 0.25); font-size: 14px; }
.msg.hint { align-self: center; text-align: center; color: var(--muted); font-size: 14px; margin-top: 30%; }
.card { align-self: stretch; background: var(--panel); border: 1px solid rgba(56, 217, 245, 0.4); border-radius: 16px; padding: 14px; }
.card p { margin: 0 0 8px; }
.card-title { font-weight: 600; color: var(--accent); }
.card pre { margin: 0 0 10px; padding: 10px; border-radius: 10px; background: #02050a; color: #c9f3ff; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
.card-actions { display: flex; gap: 10px; }
.card-actions button { flex: 1; }
.card.answered .card-actions { display: none; }
.tip { margin: 0; padding: 0 16px 4px; color: var(--muted); font-size: 12px; text-align: center; }
.composer { display: flex; align-items: flex-end; gap: 6px; padding: 8px 10px calc(env(safe-area-inset-bottom) + 8px); border-top: 1px solid var(--line); background: rgba(5, 8, 13, 0.96); }
.composer textarea { flex: 1; resize: none; max-height: 140px; font: inherit; font-size: 16px; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 10px 14px; outline: none; }
.composer textarea:focus { border-color: rgba(56, 217, 245, 0.5); }
.send { width: 44px; height: 44px; padding: 0; border-radius: 50%; font-size: 18px; }
.send.stop { background: var(--danger); }
.mic { width: 44px; height: 44px; border-radius: 50%; }
.mic.listening { background: var(--danger); animation: pulse 1.2s infinite; }
@keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.6); } 50% { box-shadow: 0 0 0 10px rgba(251, 113, 133, 0); } }
`;

export const PHONE_JS = String.raw`(function () {
  'use strict';

  var TOKEN_KEY = 'jarvis.phone.token';
  var CONVERSATION_KEY = 'jarvis.phone.conversation';
  var SPEAK_KEY = 'jarvis.phone.speak';

  function $(id) {
    return document.getElementById(id);
  }
  function load(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }
  function save(key, value) {
    try {
      if (value === null || value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) {
      /* stockage indisponible : on garde la valeur en mémoire */
    }
  }

  var standalone =
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var hashMatch = /code=(\d{6})/.exec(window.location.hash || '');
  var hashCode = hashMatch ? hashMatch[1] : '';
  if (window.location.hash && window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }

  var token = load(TOKEN_KEY);
  var conversationId = load(CONVERSATION_KEY);
  var speakReplies = load(SPEAK_KEY) !== 'off';
  var busy = false;
  var controller = null;
  var current = null;
  var tools = {};

  var list = $('messages');
  var input = $('input');
  var sendButton = $('send');
  var micButton = $('mic');

  function show(view) {
    $('view-pair').hidden = view !== 'pair';
    $('view-chat').hidden = view !== 'chat';
  }

  function setStatus(text, bad) {
    var status = $('status');
    status.textContent = text;
    status.className = bad ? 'status bad' : 'status';
  }

  function scrollDown() {
    window.requestAnimationFrame(function () {
      list.scrollTop = list.scrollHeight;
    });
  }

  function bubble(kind, text) {
    var element = document.createElement('div');
    element.className = 'msg ' + kind;
    element.textContent = text;
    list.appendChild(element);
    scrollDown();
    return element;
  }

  function emptyHint() {
    if (list.children.length === 0) {
      var hint = bubble('hint', 'Écris ou dicte ta demande : Jarvis répond depuis ton PC.');
      hint.id = 'empty-hint';
    }
  }

  function clearHint() {
    var hint = $('empty-hint');
    if (hint) hint.remove();
  }

  function forgetDevice(message) {
    token = null;
    save(TOKEN_KEY, null);
    show('pair');
    $('pair-error').textContent = message || '';
  }

  function deviceName() {
    var agent = window.navigator.userAgent || '';
    if (/iPad/.test(agent)) return 'iPad';
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/Android/.test(agent)) return 'Android';
    return 'Téléphone';
  }

  function api(path, body, signal) {
    var options = {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
      signal: signal,
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(path, options);
  }

  /* ---------- Jumelage ---------- */

  function preparePairing() {
    $('code').value = hashCode;
    if (hashCode && !standalone) {
      $('install').hidden = false;
      $('install-code').textContent = hashCode;
    }
  }

  function pair(code) {
    var error = $('pair-error');
    error.textContent = '';
    if (!/^\d{6}$/.test(code)) {
      error.textContent = 'Le code a 6 chiffres : il est affiché sur le PC, dans Réglages → Téléphone.';
      return;
    }
    $('pair-button').disabled = true;
    fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, name: deviceName() }),
      cache: 'no-store',
    })
      .then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || !data.token) throw new Error(data.error || 'Code refusé.');
          token = data.token;
          save(TOKEN_KEY, token);
          show('chat');
          start();
        });
      })
      .catch(function (reason) {
        error.textContent =
          reason && reason.message && reason.message !== 'Failed to fetch' && reason.message !== 'Load failed'
            ? reason.message
            : 'Jarvis ne répond pas : le PC est-il allumé, avec Tailscale connecté ?';
      })
      .then(function () {
        $('pair-button').disabled = false;
      });
  }

  /* ---------- Voix ---------- */

  var speechUnlocked = false;
  function unlockSpeech() {
    if (speechUnlocked || !window.speechSynthesis) return;
    speechUnlocked = true;
    try {
      var silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      window.speechSynthesis.speak(silent);
    } catch (error) {
      /* rien */
    }
  }

  function frenchVoice() {
    var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    for (var i = 0; i < voices.length; i += 1) {
      if (/^fr(-|_|$)/i.test(voices[i].lang)) return voices[i];
    }
    return null;
  }

  function speakable(text) {
    var cut = text.search(/\n\s*(\*\*)?Sources\b/);
    var body = cut >= 0 ? text.slice(0, cut) : text;
    return body
      .replace(/\x60{3}[\s\S]*?\x60{3}/g, ' (bloc de code) ')
      .replace(/[*_#\x60>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .trim();
  }

  function speak(text) {
    if (!speakReplies || !window.speechSynthesis) return;
    var spoken = speakable(text);
    if (!spoken) return;
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(spoken.slice(0, 1500));
    utterance.lang = 'fr-FR';
    var voice = frenchVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function renderSpeakButton() {
    var button = $('speak');
    button.textContent = speakReplies ? '🔊' : '🔇';
    button.setAttribute('aria-label', speakReplies ? 'Couper la lecture des réponses' : 'Lire les réponses à voix haute');
  }

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;

  function stopListening() {
    micButton.classList.remove('listening');
    if (recognition) {
      try {
        recognition.stop();
      } catch (error) {
        /* déjà arrêtée */
      }
    }
  }

  function listen() {
    if (!Recognition) return;
    if (recognition) {
      stopListening();
      return;
    }
    unlockSpeech();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    var heard = '';
    recognition = new Recognition();
    recognition.lang = 'fr-FR';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = function (event) {
      heard = '';
      for (var i = 0; i < event.results.length; i += 1) heard += event.results[i][0].transcript;
      input.value = heard;
      autosize();
    };
    recognition.onerror = function (event) {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        bubble('error', 'Le micro est refusé : autorise-le pour Jarvis (Réglages de l’iPhone → Safari → Micro), ou utilise le micro du clavier.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        bubble('error', 'Dictée interrompue (' + event.error + '). Le micro du clavier marche aussi.');
      }
    };
    recognition.onend = function () {
      micButton.classList.remove('listening');
      recognition = null;
      var text = heard.trim();
      if (text) {
        input.value = '';
        autosize();
        send(text, 'voice');
      }
    };
    micButton.classList.add('listening');
    try {
      recognition.start();
    } catch (error) {
      micButton.classList.remove('listening');
      recognition = null;
    }
  }

  /* ---------- Discussion ---------- */

  function statusLabel(status) {
    if (status === 'ok') return 'fait';
    if (status === 'denied') return 'refusé';
    return 'échec';
  }

  function confirmationCard(event) {
    var card = document.createElement('div');
    card.className = 'card';
    var title = document.createElement('p');
    title.className = 'card-title';
    title.textContent = event.forced ? 'Confirmation obligatoire' : 'Jarvis demande ton accord';
    var details = document.createElement('p');
    details.textContent = event.details;
    card.appendChild(title);
    card.appendChild(details);
    if (event.command) {
      var command = document.createElement('pre');
      command.textContent = event.command;
      card.appendChild(command);
    }
    var actions = document.createElement('div');
    actions.className = 'card-actions';
    function answer(approved) {
      yes.disabled = true;
      no.disabled = true;
      api('/api/confirm', { requestId: event.requestId, approved: approved })
        .then(function (response) {
          if (response.status === 401) forgetDevice('Ce téléphone n’est plus relié. Demande un nouveau code sur le PC.');
          card.classList.add('answered');
          title.textContent = approved ? 'Accepté' : 'Refusé';
        })
        .catch(function () {
          yes.disabled = false;
          no.disabled = false;
        });
    }
    var no = document.createElement('button');
    no.className = 'ghost';
    no.textContent = 'Refuser';
    no.onclick = function () {
      answer(false);
    };
    var yes = document.createElement('button');
    yes.textContent = 'Accepter';
    yes.onclick = function () {
      answer(true);
    };
    actions.appendChild(no);
    actions.appendChild(yes);
    card.appendChild(actions);
    list.appendChild(card);
    scrollDown();
    if (window.navigator.vibrate) window.navigator.vibrate(60);
  }

  function handle(event) {
    switch (event.type) {
      case 'started':
        conversationId = event.conversationId;
        save(CONVERSATION_KEY, conversationId);
        break;
      case 'delta':
        if (!current) current = bubble('assistant', '');
        current.textContent += event.text;
        scrollDown();
        break;
      case 'route':
        current = null;
        bubble('note', event.label + ' · ' + event.model);
        break;
      case 'tool_start':
        current = null;
        tools[event.callId] = bubble('note', 'Outil ' + event.toolName + '…');
        break;
      case 'tool_progress':
        if (tools[event.callId]) tools[event.callId].textContent = 'Outil : ' + event.message;
        break;
      case 'tool_result':
        if (tools[event.callId]) tools[event.callId].textContent = 'Outil ' + event.toolName + ' : ' + statusLabel(event.status);
        break;
      case 'confirm':
        current = null;
        confirmationCard(event);
        break;
      case 'error':
        current = null;
        bubble('error', event.message);
        break;
      case 'done': {
        current = null;
        if (event.conversationId) {
          conversationId = event.conversationId;
          save(CONVERSATION_KEY, conversationId);
        }
        var messages = event.messages || [];
        for (var i = messages.length - 1; i >= 0; i -= 1) {
          if (messages[i].role === 'assistant' && messages[i].content && messages[i].content.trim()) {
            speak(messages[i].content);
            break;
          }
          if (messages[i].role === 'user') break;
        }
        break;
      }
      default:
        break;
    }
  }

  function setBusy(value) {
    busy = value;
    sendButton.textContent = value ? '■' : '➤';
    sendButton.setAttribute('aria-label', value ? 'Arrêter' : 'Envoyer');
    sendButton.classList.toggle('stop', value);
  }

  function readStream(response) {
    if (!response.body || !response.body.getReader) {
      return response.text().then(function (text) {
        text.split('\n').forEach(function (line) {
          if (line.trim()) handle(JSON.parse(line));
        });
      });
    }
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buffer.trim()) handle(JSON.parse(buffer));
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (line) {
          if (line.trim()) handle(JSON.parse(line));
        });
        return pump();
      });
    }
    return pump();
  }

  function send(text, source) {
    var trimmed = (text || '').trim();
    if (!trimmed) return;
    unlockSpeech();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (controller) controller.abort();
    clearHint();
    current = null;
    bubble('user', trimmed);
    var mine = typeof AbortController === 'function' ? new AbortController() : null;
    controller = mine;
    setBusy(true);
    api('/api/chat', { text: trimmed, conversationId: conversationId, source: source || 'text' }, mine ? mine.signal : undefined)
      .then(function (response) {
        if (response.status === 401) {
          forgetDevice('Ce téléphone n’est plus relié. Demande un nouveau code sur le PC.');
          return;
        }
        if (!response.ok) {
          return response.json().then(
            function (data) {
              bubble('error', data.error || 'Jarvis n’a pas pu répondre.');
            },
            function () {
              bubble('error', 'Jarvis n’a pas pu répondre (' + response.status + ').');
            },
          );
        }
        if ($('status').classList.contains('bad')) setStatus('Relié à Jarvis', false);
        return readStream(response);
      })
      .catch(function (error) {
        if (error && error.name === 'AbortError') return;
        bubble('error', 'Connexion perdue : le PC est-il allumé, avec Jarvis ouvert et Tailscale connecté ? La réponse sera dans l’historique.');
        setStatus('PC injoignable', true);
      })
      .then(function () {
        if (controller === mine) {
          controller = null;
          setBusy(false);
        }
      });
  }

  function stop() {
    if (controller) controller.abort();
    controller = null;
    setBusy(false);
    api('/api/cancel', {}).catch(function () {
      /* rien */
    });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  function newConversation() {
    if (busy) stop();
    conversationId = null;
    save(CONVERSATION_KEY, null);
    list.textContent = '';
    emptyHint();
  }

  function loadConversation() {
    list.textContent = '';
    if (!conversationId) {
      emptyHint();
      return Promise.resolve();
    }
    return api('/api/conversation?id=' + encodeURIComponent(conversationId)).then(function (response) {
      if (response.status === 401) {
        forgetDevice('Ce téléphone n’est plus relié. Demande un nouveau code sur le PC.');
        return;
      }
      if (!response.ok) {
        conversationId = null;
        save(CONVERSATION_KEY, null);
        emptyHint();
        return;
      }
      return response.json().then(function (data) {
        (data.messages || []).forEach(function (message) {
          bubble(message.role === 'user' ? 'user' : 'assistant', message.content);
        });
        emptyHint();
      });
    });
  }

  function start() {
    setStatus('Connexion…', false);
    return api('/api/me')
      .then(function (response) {
        if (response.status === 401) {
          forgetDevice('Ce téléphone n’est plus relié. Demande un nouveau code sur le PC.');
          return;
        }
        return response.json().then(function (data) {
          setStatus('Relié à Jarvis ' + (data.version || ''), false);
          return loadConversation();
        });
      })
      .catch(function () {
        setStatus('PC injoignable', true);
        emptyHint();
      });
  }

  /* ---------- Branchements ---------- */

  $('pair-form').addEventListener('submit', function (event) {
    event.preventDefault();
    pair($('code').value.trim());
  });
  $('use-here').addEventListener('click', function () {
    pair(hashCode);
  });
  $('composer').addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy && !input.value.trim()) {
      stop();
      return;
    }
    var text = input.value;
    input.value = '';
    autosize();
    send(text, 'text');
  });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('composer').requestSubmit ? $('composer').requestSubmit() : sendButton.click();
    }
  });
  $('new').addEventListener('click', newConversation);
  $('speak').addEventListener('click', function () {
    speakReplies = !speakReplies;
    save(SPEAK_KEY, speakReplies ? 'on' : 'off');
    if (!speakReplies && window.speechSynthesis) window.speechSynthesis.cancel();
    renderSpeakButton();
  });
  if (Recognition) {
    micButton.addEventListener('click', listen);
  } else {
    micButton.hidden = true;
    $('tip').hidden = false;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && token && !busy) start();
  });

  renderSpeakButton();
  preparePairing();
  if (token) {
    show('chat');
    start();
  } else {
    show('pair');
  }
})();
`;

export const PHONE_MANIFEST = JSON.stringify({
  name: 'Jarvis',
  short_name: 'Jarvis',
  lang: 'fr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#05080d',
  theme_color: '#05080d',
  icons: [{ src: '/icon.png', sizes: '256x256', type: 'image/png', purpose: 'any' }],
});
