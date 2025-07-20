const PREFIX = 'lifestyle_';
function load(key){
  return JSON.parse(localStorage.getItem(PREFIX+key) || '[]');
}
function save(key,data){
  localStorage.setItem(PREFIX+key,JSON.stringify(data));
}
// ----- Tab navigation -----
function initLifestyle(){
  const navButtons=document.querySelectorAll('.lifestyle-nav button');
  navButtons.forEach(btn=>{
    btn.addEventListener('click',()=>showLifestyleTab(btn.dataset.ltab));
  });
  showLifestyleTab('dailyTab');
  document.getElementById('scheduleDate').value = new Date().toISOString().split('T')[0];
  renderSchedule();
  renderStudy();
  renderTodos();
  renderHabits();
  renderGoals();
}
function showLifestyleTab(id){
  document.querySelectorAll('.lifestyle-tab').forEach(t=>t.classList.remove('active'));
  const tab=document.getElementById(id);
  if(tab){ tab.classList.add('active'); }
}
// ----- Daily Schedule -----
function renderSchedule(){
  const list=document.getElementById('scheduleList');
  if(!list) return;
  const date=document.getElementById('scheduleDate').value;
  const items=load('schedule').filter(i=>i.date===date);
  list.innerHTML='';
  items.forEach(item=>{
    const li=document.createElement('li');
    li.textContent=item.text;
    if(item.done) li.style.textDecoration='line-through';
    li.addEventListener('click',()=>toggleScheduleItem(item.id));
    list.appendChild(li);
  });
}
function openScheduleForm(){
  const text=prompt('Schedule item');
  if(!text) return;
  const date=document.getElementById('scheduleDate').value;
  const data=load('schedule');
  data.push({id:Date.now(),date,text,done:false});
  save('schedule',data);
  renderSchedule();
}
function toggleScheduleItem(id){
  const data=load('schedule');
  const item=data.find(i=>i.id===id);
  if(item){ item.done=!item.done; save('schedule',data); renderSchedule(); }
}
if(document.getElementById('scheduleDate')){
  document.getElementById('scheduleDate').addEventListener('change',renderSchedule);
}
// ----- Study Sessions -----
let studyTimer=null,studyStart=0;
function renderStudy(){
  const list=document.getElementById('studyList');
  const filter=document.getElementById('subjectFilter');
  if(!list||!filter) return;
  const sessions=load('study');
  const subjects=[...new Set(sessions.map(s=>s.subject))];
  filter.innerHTML='<option value="">All Subjects</option>'+subjects.map(s=>`<option>${s}</option>`).join('');
  const sel=filter.value;
  list.innerHTML='';
  sessions.filter(s=>!sel||s.subject===sel).forEach(s=>{
    const li=document.createElement('li');
    li.textContent=`${s.date} - ${s.subject} - ${s.duration}m`;
    li.addEventListener('click',()=>deleteStudy(s.id));
    list.appendChild(li);
  });
}
function addSubject(){
  const sub=prompt('New subject');
  if(!sub) return;
  const opt=document.createElement('option');
  opt.textContent=sub; opt.value=sub;
  document.getElementById('subjectFilter').appendChild(opt);
  document.getElementById('subjectFilter').value=sub;
}
function startStudySession(){
  const btn=document.getElementById('studyTimerBtn');
  const display=document.getElementById('studyTimerDisplay');
  if(studyTimer){
    clearInterval(studyTimer); studyTimer=null;
    const mins=Math.round((Date.now()-studyStart)/60000);
    const subject=document.getElementById('subjectFilter').value || 'General';
    const date=new Date().toISOString().split('T')[0];
    const data=load('study');
    data.push({id:Date.now(),date,subject,duration:mins});
    save('study',data);
    display.textContent='';
    btn.textContent='Start Study Session';
    renderStudy();
  }else{
    studyStart=Date.now();
    display.textContent='0m';
    studyTimer=setInterval(()=>{
      const m=Math.floor((Date.now()-studyStart)/60000);
      display.textContent=`${m}m`;
    },60000);
    btn.textContent='Stop Session';
  }
}
function deleteStudy(id){
  if(!confirm('Delete session?')) return;
  let data=load('study');
  data=data.filter(s=>s.id!==id); save('study',data); renderStudy();
}
function openStudyForm(){
  const subject=prompt('Subject');
  const duration=parseInt(prompt('Duration (minutes)'),10);
  if(!subject||!duration) return;
  const date=new Date().toISOString().split('T')[0];
  const data=load('study');
  data.push({id:Date.now(),date,subject,duration});
  save('study',data); renderStudy();
}
if(document.getElementById('subjectFilter')){
  document.getElementById('subjectFilter').addEventListener('change',renderStudy);
}
// ----- To-do List -----
function renderTodos(){
  const list=document.getElementById('todoList');
  const filter=document.getElementById('todoCategoryFilter');
  if(!list||!filter) return;
  const todos=load('todo');
  const cats=[...new Set(todos.map(t=>t.category))];
  filter.innerHTML='<option value="">All Categories</option>'+cats.map(c=>`<option>${c}</option>`).join('');
  const sel=filter.value;
  list.innerHTML='';
  todos.filter(t=>!sel||t.category===sel).forEach(t=>{
    const li=document.createElement('li');
    const cb=document.createElement('input');
    cb.type='checkbox'; cb.checked=t.done;
    cb.onchange=()=>{t.done=cb.checked; save('todo',todos);};
    li.appendChild(cb);
    li.appendChild(document.createTextNode(' '+t.text));
    li.addEventListener('dblclick',()=>deleteTodo(t.id));
    list.appendChild(li);
  });
}
function addTodoCategory(){
  const c=prompt('New category');
  if(!c) return;
  const opt=document.createElement('option'); opt.textContent=c; opt.value=c;
  document.getElementById('todoCategoryFilter').appendChild(opt);
  document.getElementById('todoCategoryFilter').value=c;
}
function openTodoForm(){
  const text=prompt('Task');
  if(!text) return;
  const cat=document.getElementById('todoCategoryFilter').value||'General';
  const todos=load('todo');
  todos.push({id:Date.now(),text,category:cat,done:false});
  save('todo',todos); renderTodos();
}
function deleteTodo(id){
  let todos=load('todo');
  todos=todos.filter(t=>t.id!==id); save('todo',todos); renderTodos();
}
if(document.getElementById('todoCategoryFilter')){
  document.getElementById('todoCategoryFilter').addEventListener('change',renderTodos);
}
// ----- Habits -----
function renderHabits(){
  const list=document.getElementById('habitsList');
  if(!list) return;
  const habits=load('habits');
  list.innerHTML='';
  habits.forEach(h=>{
    const li=document.createElement('li');
    const chk=document.createElement('input');
    chk.type='checkbox';
    const date=new Date().toISOString().split('T')[0];
    const log=load('habitLog');
    const entry=log.find(e=>e.habit===h.id&&e.date===date);
    chk.checked=!!entry;
    chk.onchange=()=>{
      let l=load('habitLog');
      if(chk.checked){l.push({habit:h.id,date});}else{l=l.filter(e=>!(e.habit===h.id&&e.date===date));}
      save('habitLog',l);
    };
    li.appendChild(chk);
    li.appendChild(document.createTextNode(' '+h.text));
    list.appendChild(li);
  });
}
function openHabitForm(){
  const text=prompt('Habit');
  if(!text) return;
  const habits=load('habits');
  habits.push({id:Date.now(),text});
  save('habits',habits); renderHabits();
}
function addHabit(){
  openHabitForm();
}
// ----- Goals -----
function renderGoals(){
  const list=document.getElementById('goalsList');
  if(!list) return;
  const goals=load('goals');
  list.innerHTML='';
  goals.forEach(g=>{
    const li=document.createElement('li');
    const progress=document.createElement('progress');
    progress.max=g.target; progress.value=g.progress||0;
    progress.style.width='80%';
    progress.onclick=()=>{const add=+prompt('Add progress',1); if(add){g.progress=Math.min(g.target,(g.progress||0)+add); save('goals',goals); renderGoals();}}
    li.textContent=g.text+' ';
    li.appendChild(progress);
    list.appendChild(li);
  });
}
function openGoalForm(){
  const text=prompt('Goal description');
  const target=parseInt(prompt('Target amount'),10);
  if(!text||!target) return;
  const goals=load('goals');
  goals.push({id:Date.now(),text,target,progress:0});
  save('goals',goals); renderGoals();
}
function addGoalCategory(){
  openGoalForm();
}
// init on page load
window.initLifestyle = initLifestyle;
