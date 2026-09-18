const fs = require('fs');
function seg(f, a, b, label) {
  const L = fs.readFileSync(f, 'utf8').split('\n');
  const end = Math.min(b, L.length);
  console.log('=====' + label + ' total=' + L.length + ' lines ' + a + '-' + end + '=====');
  console.log(L.slice(a - 1, end).join('\n'));
}
seg('public/js/dashboard-siswa.js', 740, 1015, 'SISWA-PARKING');
seg('public/js/attendance.js', 275, 437, 'TICKET-STORE');
seg('public/js/supabase.js', 620, 9999, 'SUPABASE-TAIL');
