const defaultCourse = {id: "default", name: "默认课表"};
const registryKey = "stdoverwatch-reader:courses";
const recentKey = "stdoverwatch-reader:recent-course";
const idPattern = /^(?:default|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

function readCourses() {
  try {
    const courses = JSON.parse(localStorage.getItem(registryKey) || "[]");
    if (Array.isArray(courses)) {
      const byId = new Map([[defaultCourse.id, defaultCourse]]);
      for (const course of courses) {
        if (typeof course?.id === "string" && idPattern.test(course.id) &&
            typeof course.name === "string" && course.name.trim()) {
          byId.set(course.id, {id: course.id, name: course.name.trim().slice(0, 60)});
        }
      }
      return [...byId.values()];
    }
  } catch {}
  return [defaultCourse];
}

function currentCourse() {
  const url = new URL(location.href);
  const courses = readCourses();
  const requested = url.searchParams.get("course");
  if (requested) return courses.find(course => course.id === requested)?.id || defaultCourse.id;
  try {
    const recent = localStorage.getItem(recentKey);
    if (courses.some(course => course.id === recent)) return recent;
  } catch {}
  return defaultCourse.id;
}

export const courseId = currentCourse();

function remember(id) {
  try { localStorage.setItem(recentKey, id); } catch {}
}

export function bindCourseControls({isBusy, flush}) {
  const picker = document.getElementById("course-picker");
  const status = document.getElementById("course-status");
  const dialog = document.getElementById("course-dialog");
  const form = document.getElementById("course-form");
  const title = document.getElementById("course-dialog-title");
  const input = document.getElementById("course-name");
  const dialogStatus = document.getElementById("course-dialog-status");
  const confirm = form.querySelector("button[type=submit]");
  let creating = false, changing = false;

  function renderCourses() {
    const entries = readCourses();
    picker.replaceChildren(...entries.map(course => new Option(course.name, course.id)));
    picker.value = courseId;
    return entries.find(course => course.id === courseId)?.name || defaultCourse.name;
  }

  function destination(id, reset = false) {
    const url = new URL(location.href);
    url.searchParams.set("course", id);
    if (reset) url.hash = "";
    return url;
  }

  function switchTo(id) {
    remember(id);
    location.assign(destination(id, true));
  }

  async function prepareSwitch() {
    if (isBusy()) throw new Error("请等当前导入、问答或处理任务完成，再切换课表。");
    await flush();
    if (isBusy()) throw new Error("请等当前任务完成，再切换课表。");
  }

  picker.onchange = async () => {
    if (changing || picker.value === courseId) return;
    const next = picker.value;
    changing = picker.disabled = true;
    status.textContent = "";
    try {
      await prepareSwitch();
      switchTo(next);
    } catch (error) {
      status.textContent = error.message || "切换课表失败。";
      renderCourses();
      changing = picker.disabled = false;
    }
  };

  function openEditor(makeNew) {
    if (changing) return;
    creating = makeNew;
    title.textContent = makeNew ? "新建课表" : "保存课表";
    confirm.textContent = makeNew ? "创建并打开" : "保存";
    input.value = makeNew ? "" : renderCourses();
    dialogStatus.textContent = "";
    dialog.showModal();
    input.select();
  }

  document.getElementById("course-new").onclick = () => openEditor(true);
  document.getElementById("course-save").onclick = () => openEditor(false);
  document.getElementById("course-cancel").onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    if (changing) return;
    const name = input.value.trim();
    if (!name) { dialogStatus.textContent = "请输入课表名称。"; return; }
    changing = confirm.disabled = true;
    try {
      if (creating) await prepareSwitch();
      else await flush();
      if (!dialog.open) return;
      const id = creating ? crypto.randomUUID() : courseId;
      const courses = readCourses();
      const saved = courses.find(course => course.id === id);
      if (saved) saved.name = name;
      else courses.push({id, name});
      localStorage.setItem(registryKey, JSON.stringify(courses));
      if (creating) { switchTo(id); return; }
      renderCourses();
      dialog.close();
      status.textContent = "课表已保存。";
    } catch (error) {
      dialogStatus.textContent = error.message || "保存课表失败。";
    } finally {
      changing = confirm.disabled = false;
    }
  };
  window.addEventListener("storage", event => { if (event.key === registryKey) renderCourses(); });
  renderCourses();
  remember(courseId);
  history.replaceState(history.state, "", destination(courseId));
}
