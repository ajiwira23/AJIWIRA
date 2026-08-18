/**/
(function () {
  'use strict';

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lowPerf = isMobile || reducedMotion;

  // ========== AUDIO SYSTEM ==========
  //
  // PANDUAN AUDIO — BACA JIKA INGIN MENGUBAH SUARA
  // 

  let audioEnabled = false;
  let soundOn = true;
  let audioCtx = null;
  let lastScrollSound = 0;
  let lastHoverSound = 0;
  let lastSpokenSection = '';
  let speaking = false;
  let activeSource = null;
  let unlockAttempted = false;

  // 
  let speechToken = 0;

  const ELEVEN = {
    endpoint: '/api/tts',
    voiceId: 'cDtCy1lw43ktxm1uFIWJ',
    model: 'eleven_flash_v2_5',
    enabled: !/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.protocol !== 'file:'
  };

  const WELCOME_TEXT = "Yohoho. selamat datang di Portofolioku. Kenalin aku Aji Wira. Siap. Scroll buat keliling.";
  const WELCOME_KEY = 'welcome';

  // AudioBuffer disimpan selama halaman hidup. Cache Storage menyimpan hasil antar reload.
  const elevenCache = new Map();
  let preloadStarted = false;

  const soundBtn = document.getElementById('sound-btn');

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function stopActiveVoice() {
    try { if (activeSource) activeSource.stop(0); } catch (e) {}
    activeSource = null;
    speaking = false;
  }

  async function unlockAudio() {
    if (audioEnabled) return;
    const ctx = getCtx();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) {}
    }

    // 
    if (ctx.state !== 'running') return;

    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) {}
    audioEnabled = true;
    spokenOnce.add('hero');
    sfxHonk();
    // TIDAK ADA setTimeout. Narasi dimulai langsung.
    // Cache key disamakan dengan yang dipakai di preloadSpeech() supaya tidak fetch dua kali.
    speakRobot(WELCOME_TEXT, WELCOME_KEY);
  }

  // 
  async function tryAutoUnlock() {
    if (unlockAttempted || audioEnabled) return;
    unlockAttempted = true;
    await unlockAudio();
  }

  // 
  ['click', 'touchstart', 'keydown', 'scroll', 'wheel'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  function playTone(freq, duration, type, volume, slideTo) {
    if (!soundOn || !audioEnabled) return;
    const ctx = getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(volume || 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function sfxClick() {
    playTone(880, 0.06, 'square', 0.07, 440);
    setTimeout(() => playTone(660, 0.04, 'square', 0.04), 40);
  }

  function sfxHover() {
    const t = performance.now();
    if (t - lastHoverSound < 80) return;
    lastHoverSound = t;
    playTone(1200, 0.03, 'sine', 0.035);
  }

  function sfxSelect() {
    playTone(523, 0.05, 'triangle', 0.06);
    setTimeout(() => playTone(784, 0.08, 'triangle', 0.05), 50);
  }

  function sfxScrollTick() {
    const t = performance.now();
    if (t - lastScrollSound < 180) return;
    lastScrollSound = t;
    playTone(200 + Math.random() * 80, 0.025, 'square', 0.02);
  }

  function sfxSectionEnter() {
    playTone(392, 0.08, 'triangle', 0.06, 523);
    setTimeout(() => playTone(659, 0.12, 'sine', 0.05), 90);
  }

  function sfxToggle() {
    playTone(600, 0.05, 'sine', 0.06);
    setTimeout(() => playTone(900, 0.08, 'sine', 0.05), 60);
  }

  function sfxPopup() {
    playTone(330, 0.05, 'triangle', 0.07);
    setTimeout(() => playTone(440, 0.06, 'triangle', 0.06), 40);
    setTimeout(() => playTone(554, 0.1, 'sine', 0.05), 90);
  }

  function sfxCard() {
    playTone(700, 0.04, 'square', 0.05, 500);
    setTimeout(() => playTone(900, 0.05, 'sine', 0.04), 35);
  }

  // Aksen badut cyberpunk — SFX saja, tidak mengubah ucapan ElevenLabs.
  function sfxHonk() {
    playTone(392, 0.09, 'square', 0.09, 330);
    setTimeout(() => playTone(330, 0.11, 'square', 0.08, 262), 90);
  }

  const sectionScripts = {
    hero: "Yossha. Ini portofolioku. Kenalin aku Aji Wira. Full-stack developer yang suka bikin hal keren. Scroll aja buat explore.",
    about: "Yokey, About me thaim.",
    work: "Work zone.",
    expertise: "Skill check.",
    experience: "Jhourney far.",
    contact: "Last page. yaahhh sudah sampai akhir. terimakasih, sampai jumpa di demo selanjutnya dann. ADIOS EL KONTOLOS PARAGOS ATOS!."
  };

  function pickNaturalMaleVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    const notGoogle = (v) => !/google/i.test(v.name);
    const preferNames = [
      /microsoft david/i, /microsoft mark/i, /microsoft guy/i,
      /daniel/i, /alex/i, /fred/i, /thomas/i, /rishi/i, /aaron/i,
      /reed/i, /eddy/i, /nathan/i, /james/i, /john/i, /male/i
    ];
    let v = voices.find(x => notGoogle(x) && /id(-|_)?ID/i.test(x.lang));
    if (v) return v;
    for (const re of preferNames) {
      v = voices.find(x => notGoogle(x) && /en/i.test(x.lang) && re.test(x.name));
      if (v) return v;
    }
    v = voices.find(x => notGoogle(x) && /en(-|_)?(US|GB|AU)/i.test(x.lang) && x.localService);
    if (v) return v;
    v = voices.find(x => notGoogle(x) && /en/i.test(x.lang));
    return v || voices.find(notGoogle) || voices[0] || null;
  }

  function speechUrl(text) {
    return ELEVEN.endpoint + '?text=' + encodeURIComponent(text) + '&v=1';
  }

  async function loadSpeechBuffer(text, cacheKey) {
    const key = cacheKey || text;
    if (elevenCache.has(key)) return elevenCache.get(key);
    const ctx = getCtx();
    if (!ctx || !ELEVEN.enabled) return null;

    const url = speechUrl(text);
    try {
      const storage = 'caches' in window ? await caches.open('aji-wira-eleven-v1') : null;
      let response = storage ? await storage.match(url) : null;

      if (!response) {
        response = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'force-cache' });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          console.warn('ElevenLabs request skipped:', response.status, detail);
          return null;
        }
        if (storage) await storage.put(url, response.clone());
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      elevenCache.set(key, buffer);
      return buffer;
    } catch (err) {
      console.warn('ElevenLabs preload skipped:', err);
      return null;
    }
  }

  // Preload tanpa menunggu user. Ini membuat suara section berikutnya siap sebelum diputar.
  function preloadSpeech() {
    if (preloadStarted) return;
    preloadStarted = true;
    const jobs = Object.entries(sectionScripts).map(([id, text]) => loadSpeechBuffer(text, id));
    jobs.push(loadSpeechBuffer(WELCOME_TEXT, WELCOME_KEY));
    Promise.allSettled(jobs).catch(() => {});
  }

  // Efek CYBORG CLOWN ringan. Dry signal dominan supaya Bahasa Indonesia tetap jelas.
  function playCyborgClown(buffer) {
    const ctx = getCtx();
    if (!ctx || !buffer) return false;
    stopActiveVoice();

    const source = ctx.createBufferSource();
    const master = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const distortion = ctx.createWaveShaper();
    const bandpass = ctx.createBiquadFilter();
    const ringOsc = ctx.createOscillator();
    const ringDepth = ctx.createGain();
    const ringGain = ctx.createGain();

    const curve = new Float32Array(22050);
    const amount = 8;
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = ((3 + amount) * x * 20 * Math.PI / 180) /
        (Math.PI + amount * Math.abs(x));
    }

    source.buffer = buffer;
    source.playbackRate.value = 1.0;
    master.gain.value = 0.98;
    dry.gain.value = 0.84;
    wet.gain.value = 0.16;
    distortion.curve = curve;
    distortion.oversample = '2x';
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2500;
    bandpass.Q.value = 0.55;
    ringOsc.type = 'sine';
    ringOsc.frequency.value = 36;
    ringDepth.gain.value = 0.22;
    ringGain.gain.value = 0;

    source.connect(dry);
    dry.connect(master);
    source.connect(distortion);
    distortion.connect(bandpass);
    bandpass.connect(wet);
    wet.connect(master);
    bandpass.connect(ringGain);
    ringOsc.connect(ringDepth);
    ringDepth.connect(ringGain.gain);
    ringGain.connect(master);
    master.connect(ctx.destination);

    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.001, now);
    master.gain.exponentialRampToValueAtTime(0.98, now + 0.012);
    source.onended = () => {
      try { ringOsc.stop(); } catch (e) {}
      if (activeSource === source) activeSource = null;
      speaking = false;
    };

    activeSource = source;
    speaking = true;
    ringOsc.start(now);
    source.start(now);
    return true;
  }

  // 
  async function speakEleven(text, cacheKey, token) {
    const buffer = elevenCache.get(cacheKey || text) || await loadSpeechBuffer(text, cacheKey || text);
    if (!buffer) return false;
    if (token !== undefined && token !== speechToken) {
      // 
      return true;
    }
    return playCyborgClown(buffer);
  }

  function speakSystem(text, token) {
    if (!window.speechSynthesis) return;
    if (token !== undefined && token !== speechToken) return; // sudah basi, jangan diputar
    try {
      stopActiveVoice();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 0.82;
      u.volume = 1.0;
      u.lang = 'id-ID';
      const voice = pickNaturalMaleVoice();
      if (voice) {
        u.voice = voice;
        if (voice.lang) u.lang = voice.lang;
      }
      speaking = true;
      u.onend = () => { speaking = false; };
      u.onerror = () => { speaking = false; };
      window.speechSynthesis.speak(u);
    } catch (e) { speaking = false; }
  }

  async function speakRobot(text, cacheKey) {
    if (!soundOn || !audioEnabled) return;

    // 
    const myToken = ++speechToken;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    stopActiveVoice();

    const ok = await speakEleven(text, cacheKey || text, myToken);
    if (myToken !== speechToken) return; // sudah ada permintaan lebih baru, berhenti di sini
    if (!ok) {
      // Fallback langsung — jangan membuat user menunggu API.
      speakSystem(text, myToken);
    }
  }

  // Sections already narrated — never repeat on scroll back
  const spokenOnce = new Set();

  function narrateSection(id) {
    if (!id || spokenOnce.has(id)) return;
    spokenOnce.add(id);
    lastSpokenSection = id;
    sfxSectionEnter();
    const script = sectionScripts[id];
    // TIDAK ADA setTimeout 280ms.
    if (script) speakRobot(script, id);
  }

  if (soundBtn) {
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Unlock tetap terjadi pada gesture klik tombol.
      unlockAudio();
      soundOn = !soundOn;
      soundBtn.classList.toggle('muted', !soundOn);
      if (!soundOn) {
        stopActiveVoice();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } else {
        sfxToggle();
        speakRobot("Sound on.", 'sound-on');
      }
    });
  }

  // Mulai pemanasan suara setelah dokumen siap; tidak menghalangi rendering UI.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(preloadSpeech, { timeout: 4000 });
  } else {
    Promise.resolve().then(preloadSpeech);
  }

  // Coba autoplay sesegera mungkin (tanpa menunggu klik). Kalau browser
  // memblokirnya, listener click/touchstart/keydown di atas tetap jadi fallback.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    tryAutoUnlock();
  } else {
    document.addEventListener('DOMContentLoaded', tryAutoUnlock, { once: true });
  }
  window.addEventListener('load', tryAutoUnlock, { once: true });

  // ========== MOOD ==========
  const moods = {
    midnight: { icon: '☾', label: 'Midnight', color: 0x4ade80 },
    dawn:     { icon: '✧', label: 'Dawn',     color: 0x67e8f9 },
    daylight: { icon: '☀', label: 'Daylight', color: 0xa3e635 },
    golden:   { icon: '✦', label: 'Golden',   color: 0xfbbf24 },
    dusk:     { icon: '☽', label: 'Dusk',     color: 0xf472b6 },
    night:    { icon: '✶', label: 'Night',    color: 0x818cf8 }
  };
  let currentMood = 'midnight';
  const moodBadge = document.getElementById('mood-badge');
  const moodIcon = document.getElementById('mood-icon');
  const moodText = document.getElementById('mood-text');
  let threeMats = [];

  function setMood(mood) {
    if (mood === currentMood) return;
    currentMood = mood;
    document.body.dataset.mood = mood;
    const m = moods[mood];
    if (moodIcon) moodIcon.textContent = m.icon;
    if (moodText) moodText.textContent = m.label;
    if (moodBadge) {
      moodBadge.classList.add('pulse');
      setTimeout(() => moodBadge.classList.remove('pulse'), 500);
    }
    if (threeMats.length) {
      threeMats.forEach((mat, i) => {
        if (mat.color) {
          mat.color.setHex(m.color);
          mat.color.multiplyScalar(1 - (i % 4) * 0.18);
        }
      });
    }
  }

  function detectMoodAndSection() {
    const sections = document.querySelectorAll('section[data-mood]');
    const mid = window.innerHeight * 0.4;
    let activeMood = 'midnight';
    let activeId = 'hero';
    sections.forEach(sec => {
      const rect = sec.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom > mid) {
        activeMood = sec.dataset.mood;
        activeId = sec.id;
      }
    });
    setMood(activeMood);
    narrateSection(activeId);
  }

  // ========== LOADER ==========
  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loader-bar');
  function setProgress(n) { if (loaderBar) loaderBar.style.width = Math.min(n, 100) + '%'; }
  function finishLoader() {
    setProgress(100);
    setTimeout(() => {
      if (loader) loader.classList.add('done');
      document.body.classList.remove('loading');
      if (moodBadge) setTimeout(() => moodBadge.classList.add('show'), 400);
    }, 350);
  }
  document.body.classList.add('loading');
  setProgress(12);

  const progressBar = document.getElementById('scroll-progress');
  function updateProgress() {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const height = doc.scrollHeight - doc.clientHeight;
    if (progressBar) progressBar.style.width = (height > 0 ? (scrollTop / height) * 100 : 0) + '%';
  }

  const parallaxEls = [];
  const bgLayers = document.querySelectorAll('.p-layer');
  function initParallax() {
    if (reducedMotion || lowPerf) return;
    document.querySelectorAll('[data-parallax]').forEach(el => {
      parallaxEls.push({ el, speed: parseFloat(el.dataset.parallax) || 0.05 });
    });
  }
  function updateParallax() {
    if (reducedMotion || lowPerf) return;
    const scrollY = window.scrollY;
    bgLayers.forEach(layer => {
      const speed = parseFloat(layer.dataset.speed) || 0.2;
      layer.style.transform = 'translate3d(0, ' + (scrollY * speed) + 'px, 0)';
    });
    parallaxEls.forEach(item => {
      const rect = item.el.getBoundingClientRect();
      const offset = (rect.top + rect.height / 2 - window.innerHeight / 2) * item.speed;
      item.el.style.transform = 'translate3d(0, ' + offset + 'px, 0)';
    });
  }

  const appBar = document.getElementById('app-bar');
  const menuBtn = document.getElementById('menu-btn');
  const menuOverlay = document.getElementById('menu-overlay');
  let lastScroll = 0;

  function toggleMenu() {
    const open = menuOverlay.classList.toggle('open');
    menuBtn.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) sfxPopup();
    else sfxSelect();
  }
  if (menuBtn) menuBtn.addEventListener('click', toggleMenu);
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
      sfxClick();
      if (menuOverlay.classList.contains('open')) toggleMenu();
    });
    item.addEventListener('mouseenter', sfxHover);
  });

  const dots = document.querySelectorAll('.dot');
  function updateDots() {
    let current = '';
    document.querySelectorAll('section[id]').forEach(sec => {
      if (window.scrollY >= sec.offsetTop - 120) current = sec.id;
    });
    dots.forEach(d => d.classList.toggle('active', d.dataset.section === current));
  }
  dots.forEach(d => {
    d.addEventListener('mouseenter', sfxHover);
    d.addEventListener('click', sfxClick);
  });

  const backTop = document.getElementById('back-top');
  function updateBackTop() {
    if (backTop) backTop.classList.toggle('show', window.scrollY > 500);
  }
  if (backTop) {
    backTop.addEventListener('click', () => {
      sfxClick();
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      appBar.classList.toggle('scrolled', y > 30);
      if (y > lastScroll && y > 120) appBar.classList.add('hidden');
      else appBar.classList.remove('hidden');
      if (Math.abs(y - lastScroll) > 40) sfxScrollTick();
      lastScroll = y;
      updateProgress();
      updateDots();
      updateBackTop();
      detectMoodAndSection();
      updateParallax();
      ticking = false;
    });
  }, { passive: true });

  const cursor = document.getElementById('cursor');
  const cursorDot = document.getElementById('cursor-dot');
  if (!isMobile && cursor && cursorDot) {
    document.body.classList.add('show-cursor');
    let mx = 0, my = 0, cx = 0, cy = 0, dx = 0, dy = 0;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });
    document.querySelectorAll('a, button, .work-card, .exp-card, .social-link, .contact-main, .dot').forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursorDot.classList.add('hover');
        sfxHover();
      });
      el.addEventListener('mouseleave', () => cursorDot.classList.remove('hover'));
    });
    (function loop() {
      cx += (mx - cx) * 0.1; cy += (my - cy) * 0.1;
      dx += (mx - dx) * 0.35; dy += (my - dy) * 0.35;
      cursor.style.left = cx + 'px'; cursor.style.top = cy + 'px';
      cursorDot.style.left = dx + 'px'; cursorDot.style.top = dy + 'px';
      requestAnimationFrame(loop);
    })();
  }

  const particlesEl = document.getElementById('particles');
  if (particlesEl && !lowPerf && !reducedMotion) {
    const count = isMobile ? 5 : 12;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDuration = (8 + Math.random() * 14) + 's';
      p.style.animationDelay = Math.random() * 10 + 's';
      p.style.width = p.style.height = (2 + Math.random() * 3) + 'px';
      particlesEl.appendChild(p);
    }
  }

  if (!isMobile && !reducedMotion) {
    document.querySelectorAll('[data-magnetic]').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const rect = btn.getBoundingClientRect();
        btn.style.transform = 'translate(' + ((e.clientX - rect.left - rect.width / 2) * 0.22) + 'px, ' + ((e.clientY - rect.top - rect.height / 2) * 0.22) + 'px)';
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  document.querySelectorAll('.btn-primary, .btn-ghost, .work-link, .social-link, .contact-main').forEach(btn => {
    btn.addEventListener('click', function (e) {
      sfxClick();
      if (this.classList.contains('btn-primary') || this.classList.contains('btn-ghost')) {
        const rect = this.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        const size = Math.max(rect.width, rect.height) * 1.5;
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      }
    });
  });

  // Card / box click + hover sounds (all devices)
  document.querySelectorAll('.work-card, .exp-card, .metric, .tl-item').forEach(el => {
    el.addEventListener('mouseenter', sfxHover);
    el.addEventListener('click', function () {
      sfxCard();
    });
  });

  if (!isMobile && !reducedMotion) {
    document.querySelectorAll('[data-tilt]').forEach(card => {
      card.addEventListener('mousemove', e => {
        const rect = card.getBoundingClientRect();
        const rotX = ((e.clientY - rect.top - rect.height / 2) / rect.height) * -8;
        const rotY = ((e.clientX - rect.left - rect.width / 2) / rect.width) * 8;
        card.style.transform = 'perspective(900px) rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) scale3d(1.015,1.015,1.015)';
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
      card.addEventListener('mouseenter', sfxHover);
    });
  }

  function animateCounter(el, target, duration) {
    const start = performance.now();
    (function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    })(start);
  }

  const revealEls = document.querySelectorAll('.section-label, .section-heading, .about-layout, .work-card, .exp-card, .tl-item, .contact-intro, .contact-actions, .contact-socials, .timeline');
  revealEls.forEach((el, i) => {
    el.classList.add('reveal');
    if (el.classList.contains('work-card') || el.classList.contains('exp-card') || el.classList.contains('tl-item')) {
      el.classList.add('reveal-delay-' + ((i % 4) + 1));
    }
  });

  if ('IntersectionObserver' in window && !reducedMotion) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          if (entry.target.classList.contains('about-layout')) {
            entry.target.querySelectorAll('[data-count]').forEach(el => {
              animateCounter(el, parseInt(el.dataset.count, 10), 1400);
            });
          }
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in'));
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = el.dataset.count; });
  }

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const id = this.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      sfxSelect();
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 64, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  });

  const canvas = document.getElementById('canvas3d');
  let scene, camera, renderer, threeMeshes = [];

  function initScene() {
    if (!canvas || typeof THREE === 'undefined') { finishLoader(); return; }
    setProgress(40);
    try {
    const w = window.innerWidth, h = window.innerHeight;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 80);
    camera.position.set(0, 0.5, 11);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: !isMobile, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 2));
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.AmbientLight(0x1a2a1a, 0.5));
    const key = new THREE.DirectionalLight(0x4ade80, 0.7);
    key.position.set(4, 6, 5); scene.add(key);
    const fill = new THREE.PointLight(0x4ade80, 0.3, 25);
    fill.position.set(-5, 2, 3); scene.add(fill);

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const cols = [0x4ade80, 0x22c55e, 0x16a34a, 0x15803d];
    threeMats = cols.map(function(c) {
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 + Math.random() * 0.3, metalness: 0.1, transparent: true, opacity: 0.5 + Math.random() * 0.3 });
    });

    const count = lowPerf ? 7 : 14;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, threeMats[i % threeMats.length]);
      mesh.scale.setScalar(0.25 + Math.random() * 0.65);
      mesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8 - 1);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      mesh.userData = { rot: 0.002 + Math.random() * 0.005, phase: Math.random() * Math.PI * 2, baseY: mesh.position.y };
      scene.add(mesh); threeMeshes.push(mesh);
    }

    if (!lowPerf) {
      const wire = new THREE.MeshBasicMaterial({ color: 0x4ade80, wireframe: true, transparent: true, opacity: 0.18 });
      threeMats.push(wire);
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(geo, wire);
        m.scale.setScalar(0.9 + Math.random());
        m.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, -5 - Math.random() * 3);
        m.userData = { rot: 0.0015 + Math.random() * 0.002, phase: Math.random() * 6, baseY: m.position.y };
        scene.add(m); threeMeshes.push(m);
      }
    }

    setProgress(75);
    let tx = 0, ty = 0;
    if (!isMobile) {
      document.addEventListener('mousemove', e => {
        tx = (e.clientX / window.innerWidth - 0.5) * 1.8;
        ty = (e.clientY / window.innerHeight - 0.5) * 1.2;
      }, { passive: true });
    }
    let ox = 0, oy = 0;
    if (isMobile && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', e => {
        if (e.gamma != null) ox = Math.max(-1, Math.min(1, e.gamma / 50));
        if (e.beta != null) oy = Math.max(-1, Math.min(1, (e.beta - 40) / 50));
      }, { passive: true });
    }

    let t = 0;
    (function animate() {
      requestAnimationFrame(animate);
      t += 0.016;
      threeMeshes.forEach(m => {
        m.rotation.x += m.userData.rot;
        m.rotation.y += m.userData.rot * 0.65;
        if (m.userData.baseY !== undefined) m.position.y = m.userData.baseY + Math.sin(t + m.userData.phase) * 0.3;
      });
      const px = isMobile ? ox * 0.7 : tx;
      const py = isMobile ? oy * 0.4 : ty;
      camera.position.x += (px - camera.position.x) * 0.035;
      camera.position.y += (0.5 + py - camera.position.y) * 0.035;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    })();

    setProgress(90);
    let resizeTO;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(() => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }, 120);
    }, { passive: true });

    setTimeout(finishLoader, 280);
    } catch (err) {
      // WebGL tidak tersedia/gagal dibuat (mis. di browser dalam-app seperti Facebook/Instagram) — lanjut tanpa dekorasi 3D
      console.warn('3D scene skipped:', err);
      finishLoader();
    }
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function () {
      window.speechSynthesis.getVoices();
    };
  }

  initParallax();
  if (document.readyState === 'complete') setTimeout(initScene, 80);
  else window.addEventListener('load', () => setTimeout(initScene, 80));
  setTimeout(() => { if (loader && !loader.classList.contains('done')) finishLoader(); }, 3500);

})();
