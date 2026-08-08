// Google reviews widget (homepage) — loads up to 5 reviews via the Places API.
// Fill in window.GOOGLE_PLACES_CONFIG (see index.html) to activate.
// Docs: https://developers.google.com/maps/documentation/javascript/place-details

(function () {
  const grid = document.getElementById('reviewsGrid');
  const summaryEl = document.getElementById('reviewsSummary');
  const loadingEl = document.getElementById('reviewsLoading');
  const errorEl = document.getElementById('reviewsError');
  const attributionEl = document.getElementById('reviewsAttribution');
  if (!grid) return;

  const cfg = window.GOOGLE_PLACES_CONFIG;
  const section = document.getElementById('reviewsSection');

  if (!cfg || !cfg.apiKey || !cfg.placeId || cfg.apiKey.indexOf('YOUR_') === 0 || cfg.placeId.indexOf('YOUR_') === 0) {
    // Not configured yet — hide the whole section instead of showing a broken "loading" state.
    if (section) section.style.display = 'none';
    return;
  }

  const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z';

  function starsSvg(count, size) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${STAR_PATH}"/></svg>`;
    }
    return html;
  }

  function showError() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
  }

  function renderReviews(place) {
    loadingEl.style.display = 'none';

    const rating = place.rating || 0;
    const total = place.user_ratings_total || 0;
    summaryEl.innerHTML = `
      <span class="rs-score">${rating.toFixed(1)}</span>
      <span class="rs-stars">${starsSvg(Math.round(rating), 20)}</span>
      <span class="rs-count">(${total} ביקורות בגוגל)</span>
      ${place.url ? `<a class="rs-link" href="${place.url}" target="_blank" rel="noopener">לכל הביקורות ←</a>` : ''}
    `;

    const reviews = (place.reviews || []).slice(0, 5);
    if (!reviews.length) {
      showError();
      return;
    }

    grid.innerHTML = reviews.map(r => {
      const initial = (r.author_name || '?').trim().charAt(0);
      const avatar = r.profile_photo_url
        ? `<img class="rc-avatar" src="${r.profile_photo_url}" alt="${r.author_name}" referrerpolicy="no-referrer">`
        : `<span class="rc-avatar">${initial}</span>`;
      return `
        <article class="review-card">
          <div class="rc-head">
            ${avatar}
            <div>
              <div class="rc-name">${r.author_name || 'לקוח'}</div>
              <div class="rc-time">${r.relative_time_description || ''}</div>
            </div>
          </div>
          <div class="rc-stars">${starsSvg(r.rating || 5, 14)}</div>
          <p class="rc-text">${(r.text || '').replace(/</g, '&lt;')}</p>
        </article>
      `;
    }).join('');

    attributionEl.innerHTML = `מבוסס על ביקורות אמיתיות מ-Google`;
  }

  window.__initGoogleReviews = function () {
    try {
      const svc = new google.maps.places.PlacesService(document.createElement('div'));
      svc.getDetails(
        { placeId: cfg.placeId, fields: ['name', 'rating', 'user_ratings_total', 'reviews', 'url'] },
        (place, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            renderReviews(place);
          } else {
            showError();
          }
        }
      );
    } catch (e) {
      showError();
    }
  };

  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${cfg.apiKey}&libraries=places&language=he&loading=async&callback=__initGoogleReviews`;
  script.async = true;
  script.onerror = showError;
  document.head.appendChild(script);
})();
