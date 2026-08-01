// A.L מערכות ופתרונות פיננסים — shared behaviour

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
  const count = 42;
  const speed = 0.15;
  const lineDist = 130;
  let w, h, points;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    w = canvas.width = rect.width * devicePixelRatio;
    h = canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function seed() {
    points = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * speed * devicePixelRatio,
      vy: (Math.random() - 0.5) * speed * devicePixelRatio,
      r: (Math.random() * 1.6 + 1) * devicePixelRatio
    }));
  }

  function drawFrame() {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < lineDist * devicePixelRatio) {
          ctx.strokeStyle = `rgba(${dotColor},${(1 - d / (lineDist * devicePixelRatio)) * 0.3})`;
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

  function tick() {
    for (const p of points) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    }
    drawFrame();
    if (!reduced) requestAnimationFrame(tick);
  }

  resize();
  seed();
  drawFrame();
  if (!reduced) requestAnimationFrame(tick);

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

// journey rail — page-wide scroll stage tracker (homepage)
document.addEventListener('DOMContentLoaded', () => {
  const items = document.querySelectorAll('.journey-item');
  if (!items.length || !('IntersectionObserver' in window)) return;

  const stages = Array.from(items).map(item => ({
    item,
    el: document.getElementById(item.getAttribute('href').slice(1))
  })).filter(s => s.el);

  const setActive = (key) => {
    items.forEach(i => i.classList.toggle('active', i.dataset.journey === key));
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const stage = stages.find(s => s.el === entry.target);
        if (stage) setActive(stage.item.dataset.journey);
      }
    });
  }, { rootMargin: '-45% 0px -45% 0px' });

  stages.forEach(s => io.observe(s.el));

  items.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(item.getAttribute('href').slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
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
