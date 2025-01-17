export class SidebarTextEntry {
  constructor(sceneController, textSettingsController) {
    this.sceneController = sceneController;
    this.textSettingsController = textSettingsController;
    this.textSettings = textSettingsController.model;

    this.setupTextEntryElement();
    this.setupTextAlignElement();
    this.setupIntersectionObserver();
  }

  setupTextEntryElement() {
    this.textEntryElement = document.querySelector("#text-entry-textarea");
    this.textEntryElement.value = this.textSettings.text;

    const updateTextEntryElementFromModel = (key, newValue) => {
      if (this.textEntryElement.value !== newValue) {
        this.textEntryElement.value = newValue;
        this.textEntryElement.setSelectionRange(0, 0);
      }
    };

    this.textSettingsController.addKeyListener(
      "text",
      updateTextEntryElementFromModel,
      false
    );

    this.textEntryElement.addEventListener(
      "input",
      () => {
        this.textSettingsController.setItem(
          "text",
          this.textEntryElement.value,
          updateTextEntryElementFromModel
        );
      },
      false
    );

    this.textSettingsController.addKeyListener(
      "text",
      (key, newValue) => this.fixTextEntryHeight(),
      false
    );
  }

  focusTextEntry() {
    this.textEntryElement.focus();
  }

  setupIntersectionObserver() {
    const observer = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio > 0) {
            this.fixTextEntryHeight();
          }
        });
      },
      {
        root: document.documentElement,
      }
    );
    observer.observe(this.textEntryElement);
  }

  setupTextAlignElement() {
    this.textAlignElement = document.querySelector("#text-align-menu");
    this.updateAlignElement(this.textSettings.align);

    this.textSettingsController.addKeyListener("align", (key, newValue) => {
      this.updateAlignElement(this.textSettings.align);
    });

    for (const el of this.textAlignElement.children) {
      el.onclick = (event) => {
        if (event.target.classList.contains("selected")) {
          return;
        }
        this.textSettings.align = el.dataset.align;
      };
    }
  }

  updateAlignElement(align) {
    for (const el of this.textAlignElement.children) {
      el.classList.toggle("selected", align === el.dataset.align);
    }
  }

  fixTextEntryHeight() {
    // This adapts the text entry height to its content
    this.textEntryElement.style.height = "auto";
    this.textEntryElement.style.height = this.textEntryElement.scrollHeight + 14 + "px";
  }
}
