# A.L מערכות ופתרונות פיננסים — אתר

אתר סטטי (HTML/CSS/JS בלבד, ללא צורך בשרת) מוכן להעלאה ל-GitHub Pages, ובהמשך לדומיין משלכם.

## מבנה הקבצים
```
index.html      → עמוד הבית
systems.html    → כל המערכות בפירוט
about.html      → אודות
contact.html    → צור קשר + טופס יצירת קשר
css/style.css   → כל העיצוב
js/main.js      → תפריט מובייל, אנימציות גלילה
assets/         → הלוגו שלכם (מתוך הקבצים שהעליתם)
```

## לפני שמעלים — 3 דברים לסגור

1. **טופס יצירת הקשר (contact.html)** — פתחו חשבון חינמי ב-[Formspree](https://formspree.io), צרו טופס וקבלו מזהה (form ID). בקובץ `contact.html` חפשו את השורה:
   ```html
   <form action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
   ```
   והחליפו את `YOUR_FORM_ID` במזהה שקיבלתם.

2. **מספר הוואטסאפ** — מופיע כמה פעמים כ-`972509143496` (הפורמט הבינלאומי ל-050-9143496). אם המספר לא נכון, חפשו `972509143496` בכל הקבצים והחליפו.

3. **הפרטים באודות** — בעמוד `about.html` מופיע השם "אדיר" ותיאור קצר. עדכנו לפי הרצון שלכם.

## העלאה ל-GitHub Pages

1. צרו repository חדש ב-GitHub (למשל `al-systems-site`).
2. העלו את **כל התוכן של התיקייה הזו** (לא את התיקייה עצמה) לשורש ה-repository.
3. בהגדרות ה-repository → **Settings → Pages**:
   - Source: **Deploy from a branch**
   - Branch: **main** (או master), תיקייה: **/ (root)**
4. שמרו — האתר יעלה תוך דקה־שתיים בכתובת:
   `https://USERNAME.github.io/al-systems-site/`

## חיבור דומיין אישי (בהמשך)
ב-Settings → Pages → Custom domain, הזינו את הדומיין שרכשתם, והוסיפו רשומת CNAME אצל ספק הדומיין שמצביעה ל-`USERNAME.github.io`. GitHub ידריך אתכם צעד־צעד בממשק.

## הרצה מקומית לבדיקה
פתיחת `index.html` ישירות בדפדפן עובדת, אבל מומלץ להריץ שרת מקומי קטן כדי שהניווט בין העמודים יעבוד באופן זהה לאתר החי:
```bash
cd al-systems-site
python3 -m http.server 8000
```
ואז גלשו ל- `http://localhost:8000`
