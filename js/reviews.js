// Google reviews widget (homepage) — static rating + hand-picked real Google reviews.

(function () {
  const grid = document.getElementById('reviewsGrid');
  const summaryEl = document.getElementById('reviewsSummary');
  const loadingEl = document.getElementById('reviewsLoading');
  const errorEl = document.getElementById('reviewsError');
  const attributionEl = document.getElementById('reviewsAttribution');
  if (!grid) return;

  // Static Google Business Profile data. The live Places API call was removed: the legacy
  // PlacesService is closed to new Google Cloud customers and the key was failing
  // (RefererNotAllowedMapError), so visitors saw "couldn't load reviews". This also drops
  // a ~100KB Maps script from the homepage. Update rating/total here when the profile changes.
  const PLACE_ID = 'ChIJb_HuNpSHAhURnQ7sLDRkMwU';
  const PLACE = {
    rating: 5.0,
    user_ratings_total: 49, // as of 2026-10-31
    url: 'https://www.google.com/maps/place/?q=place_id:' + PLACE_ID,
    writeReviewUrl: 'https://search.google.com/local/writereview?placeid=' + PLACE_ID
  };

  const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z';

  // Curated selection of real Google reviews (hand-picked — the Places API doesn't
  // support choosing specific reviews, so this list is maintained manually here).
  const CURATED_REVIEWS = [
    { author_name: 'Yana Yana', relative_time_description: 'לפני 11 חודשים', rating: 5, text: 'השירות היה מהיר ואיכותי, ירד לפרטים הקטנים ביותר בעסקה.' },
    { author_name: 'איילה מור', relative_time_description: 'לפני 3 שנים', rating: 5, text: 'לאחר שיחת ייעוץ ראשוני הבנתי שזה האדם שאני רוצה שילווה אותי לאורך כל התהליך ובהחלט לא טעיתי :-)' },
    { author_name: 'החזר פלוס', relative_time_description: 'לפני 10 חודשים', rating: 5, text: 'לאורך כל התהליך הרגשנו שאנחנו בידיים טובות. אדיר היהה זמין לכל שאלה, ענה בסבלנות רבה והסביר לנו כל שלב בצורה ברורה ומובנת.' },
    { author_name: 'Gad Tzarfati', relative_time_description: 'לפני 3 שנים', rating: 5, text: 'נתן לי שירות מעולה עם ליווי אישי לאורך כל התהליך ממליץ בחום' },
    { author_name: 'roey treister', relative_time_description: 'לפני שנתיים', rating: 5, text: 'כבר בפגישה הראשונה הבנתי שאדיר הוא האדם שאני רוצה שילווה אותי בתהליך הארוך והמתיש הזה. הוא הפך הכל לקליל מאוד ודאג לעדכן אותי שלב אחר שלב במתרחש והכי חשוב חסך לי המון כסף.' }
  ];

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
      ${place.writeReviewUrl ? `<a class="rs-link" href="${place.writeReviewUrl}" target="_blank" rel="noopener">כתבו ביקורת ←</a>` : ''}
    `;

    grid.innerHTML = CURATED_REVIEWS.map(r => {
      const initial = (r.author_name || '?').trim().charAt(0);
      const avatar = `<span class="rc-avatar">${initial}</span>`;
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

  renderReviews(PLACE);
})();
