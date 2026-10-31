// A.L Systems — shared behaviour

document.addEventListener('DOMContentLoaded', () => {
  // mobile nav toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      nav.classList.toggle('open');
      const expanded = nav.classList.contains('open');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav-links a').forEach(a => {
      a.addEventListener('click', () => nav.classList.remove('open'));
    });
  }

  // scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  // hero ledger-graph draw-in (respects reduced motion via CSS)
  const graph = document.querySelector('.ledger-graph');
  if (graph) {
    graph.classList.add('draw');
  }

  // ambient particle network on every dark hero panel
  document.querySelectorAll('.hero-canvas').forEach(initParticleNetwork);

  // process rail scroll-spy
  const rail = document.getElementById('processRail');
  const steps = document.querySelectorAll('.process-step');
  if (rail && steps.length && 'IntersectionObserver' in window) {
    const railItems = rail.querySelectorAll('.process-rail-item');
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const step = entry.target.dataset.step;
          railItems.forEach(item => item.classList.toggle('active', item.dataset.step === step));
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    steps.forEach(step => spy.observe(step));
  }
});

function initParticleNetwork(canvas) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const dotColor = '221,176,95';
  const isMobile = window.matchMedia('(max-width: 720px)').matches;
  const count = isMobile ? 20 : 42;
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
  const speed = 0.15;
  const lineDist = 130;
  let w, h, points;
  let running = false;
  let rafId = null;
  let visible = true;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = canvas.width = rect.width * dpr;
    h = canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function seed() {
    points = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * speed * dpr,
      vy: (Math.random() - 0.5) * speed * dpr,
      r: (Math.random() * 1.6 + 1) * dpr
    }));
  }

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < lineDist * dpr) {
          ctx.strokeStyle = `rgba(${dotColor},${(1 - d / (lineDist * dpr)) * 0.3})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const p of points) {
      ctx.fillStyle = `rgba(${dotColor},0.75)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let frame = 0;
  function tick() {
    // On phones, draw every other frame (~30fps) - the effect looks the same, at half the CPU cost.
    if (isMobile && (frame++ & 1)) { if (running) rafId = requestAnimationFrame(tick); return; }
    for (const p of points) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    drawFrame();
    if (running) rafId = requestAnimationFrame(tick);
  }

  let ready = false; // don't animate until the page has finished loading
  function start() {
    if (!ready || running || reduced || !visible || document.hidden) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  resize();
  seed();
  drawFrame();
  // The static first frame is drawn immediately; motion starts once the page has
  // loaded and the browser is idle, so it never competes with the first render.
  const begin = () => { ready = true; start(); };
  const whenIdle = () => ('requestIdleCallback' in window) ? requestIdleCallback(begin, { timeout: 3000 }) : setTimeout(begin, 1500);
  if (document.readyState === 'complete') whenIdle(); else window.addEventListener('load', whenIdle, { once: true });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        visible = entry.isIntersecting;
        if (visible) start(); else stop();
      });
    }, { threshold: 0.01 });
    io.observe(canvas);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); seed(); drawFrame(); }, 150);
  });
}

// contact form submission (Supabase Edge Function -> Resend)
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  const status = document.getElementById('contactFormStatus');
  if (!form || !status) return;

  const endpoint = form.dataset.endpoint;
  const submitBtn = form.querySelector('button[type="submit"]');
  const defaultStatusText = status.textContent;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      message: form.message.value.trim()
    };

    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.7';
    status.textContent = 'שולח...';
    status.style.color = '';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        form.reset();
        status.textContent = 'הפנייה נשלחה בהצלחה — אחזור אליכם בהקדם.';
        status.style.color = 'var(--gold-deep)';
      } else {
        throw new Error('send_failed');
      }
    } catch {
      status.textContent = 'משהו השתבש בשליחה. אפשר לנסות שוב, או לפנות ישירות בטלפון/וואטסאפ למעלה.';
      status.style.color = '#b3453a';
    } finally {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '';
      setTimeout(() => {
        if (!submitBtn.disabled) { status.textContent = defaultStatusText; status.style.color = ''; }
      }, 8000);
    }
  });
});

// scroll progress bar (homepage)
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('scrollProgressBar');
  if (!bar) return;

  const update = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
});

// scroll thread — a thin gold line that fills as you scroll, connecting sections (desktop only, see CSS)
document.addEventListener('DOMContentLoaded', () => {
  const thread = document.createElement('div');
  thread.className = 'scroll-thread';
  thread.setAttribute('aria-hidden', 'true');
  thread.innerHTML = '<div class="scroll-thread-fill"></div><div class="scroll-thread-node"></div>';
  document.body.appendChild(thread);

  const fill = thread.querySelector('.scroll-thread-fill');
  const node = thread.querySelector('.scroll-thread-node');

  const update = () => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
    fill.style.height = pct + '%';
    node.style.top = pct + '%';
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
});

// count-up numbers — animates any [data-count] element into view once
document.addEventListener('DOMContentLoaded', () => {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateCount(el) {
    const target = parseInt(el.dataset.count, 10);
    if (!target || reduced) { el.textContent = el.dataset.count; return; }
    const duration = 1100;
    const start = performance.now();
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.6 });
    counters.forEach(el => io.observe(el));
  } else {
    counters.forEach(el => { el.textContent = el.dataset.count; });
  }
});

// live activity feed demo (homepage)
document.addEventListener('DOMContentLoaded', () => {
  const feed = document.getElementById('liveFeed');
  if (!feed) return;

  const events = [
    'פנייה חדשה נקלטה מהאתר',
    'המערכת שייכה אותה אוטומטית לנציג פנוי',
    'תזכורת מעקב נשלחה ללקוח בוואטסאפ',
    'הדשבורד עודכן בזמן אמת',
    'דוח יומי נשלח למנהל',
    'מסמך חדש הועלה ותויג אוטומטית'
  ];

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_VISIBLE = 5;
  let i = 0;
  let timer = null;

  function pad(n) { return String(n).padStart(2, '0'); }

  function addLine() {
    const now = new Date();
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const line = document.createElement('div');
    line.className = 'live-feed-item';
    line.innerHTML = `<span class="lf-time">${time}</span><span>${events[i % events.length]}</span>`;
    feed.appendChild(line);
    i++;
    while (feed.children.length > MAX_VISIBLE) {
      feed.removeChild(feed.firstElementChild);
    }
  }

  if (reduced) {
    events.slice(0, MAX_VISIBLE).forEach(() => addLine());
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !timer) {
        addLine();
        timer = setInterval(addLine, 2200);
      } else if (!entry.isIntersecting && timer) {
        clearInterval(timer);
        timer = null;
      }
    });
  }, { threshold: 0.4 });

  io.observe(feed);
});
