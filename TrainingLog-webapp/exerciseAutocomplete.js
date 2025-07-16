function loadUserExercises(user) {
  if (!user) return [];
  const key = `exercises_${user}`;
  const data = JSON.parse(localStorage.getItem(key)) || [];
  return Array.isArray(data) ? data : [];
}

function saveUserExercise(user, name) {
  if (!user || !name) return [];
  const key = `exercises_${user}`;
  const list = loadUserExercises(user);
  if (!list.includes(name)) {
    list.push(name);
    localStorage.setItem(key, JSON.stringify(list));
  }
  return list;
}

if (typeof module !== 'undefined') {
  module.exports = { loadUserExercises, saveUserExercise };
}
if (typeof window !== 'undefined') {
  window.loadUserExercises = (user) => loadUserExercises(user);
  window.saveUserExercise = (name) => saveUserExercise(window.currentUser, name);
}
