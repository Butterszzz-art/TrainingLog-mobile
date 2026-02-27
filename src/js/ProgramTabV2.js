(function () {
  function initProgramTabV2(container) {
    if (!container) return;
    if (container.__mounted) return;
    container.__mounted = true;

    const core = window.programBuilderV2Core;
    if (!core) {
      container.innerHTML = "<p style='padding:12px'>Program core not loaded.</p>";
      return;
    }

    container.innerHTML = `
      <div style="padding:12px">
        <h2 style="margin:0 0 8px 0">Program Builder V2</h2>
        <p style="opacity:.8;margin:0 0 12px 0">UI is mounted. Next: build the wizard screens.</p>
        <button id="pbv2CreateDraft">Create new draft</button>
      </div>
    `;

    container.querySelector("#pbv2CreateDraft")?.addEventListener("click", () => {
      const userId = (window.getActiveUsername && window.getActiveUsername()) || "anonymous";
      const draft = core.createEmptyDraft(userId);
      core.saveDraft(userId, draft);
      alert("Draft created and saved.");
    });
  }

  window.initProgramTabV2 = initProgramTabV2;
})();
