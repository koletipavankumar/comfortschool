document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  const forms = Array.from(document.querySelectorAll('form'));
  forms.forEach((form) => {
    form.addEventListener('submit', () => {
      const submit = form.querySelector('button[type="submit"]');
      if (submit) {
        submit.disabled = true;
        submit.classList.add('loading');
      }
    });
  });

  const confirmSelectors = 'form[action$="/delete"], form[action*="/toggle"], form[action="/admin/logout"]';
  const confirmForms = document.querySelectorAll(confirmSelectors);
  confirmForms.forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm('Are you sure you want to continue?')) {
        event.preventDefault();
      }
    });
  });

  const fileInputs = document.querySelectorAll('input[type="file"]');
  fileInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      const file = event.target.files[0];
      const label = event.target.closest('label');
      if (file && label) {
        let fileNote = label.querySelector('.file-name');
        if (!fileNote) {
          fileNote = document.createElement('div');
          fileNote.className = 'file-name';
          label.appendChild(fileNote);
        }
        fileNote.textContent = `Selected file: ${file.name}`;
      }
    });
  });

  const mediaSearch = document.getElementById('media-search');
  const mediaSort = document.getElementById('media-sort');
  const mediaList = document.querySelector('[data-media-list]');
  const mediaCards = mediaList ? Array.from(mediaList.querySelectorAll('.media-card-list')) : [];
  let currentPage = 1;
  const pageSize = 6;

  function renderMediaItems() {
    const query = mediaSearch?.value.trim().toLowerCase() || '';
    const sort = mediaSort?.value || 'newest';
    const filtered = mediaCards.filter((card) => card.dataset.search.includes(query));

    if (sort === 'title') {
      filtered.sort((a, b) => a.dataset.search.localeCompare(b.dataset.search));
    } else if (sort === 'category') {
      filtered.sort((a, b) => a.dataset.search.split(' ').slice(-1).join('').localeCompare(b.dataset.search.split(' ').slice(-1).join('')));
    } else if (sort === 'oldest') {
      filtered.reverse();
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    mediaCards.forEach((card) => {
      card.style.display = visible.includes(card) ? '' : 'none';
    });

    let pagination = document.querySelector('.pagination-controls');
    if (!pagination && mediaList) {
      pagination = document.createElement('div');
      pagination.className = 'pagination-controls';
      pagination.innerHTML = `
        <button type="button" class="btn btn-secondary" data-pagination="prev">Previous</button>
        <span class="pagination-summary"></span>
        <button type="button" class="btn btn-secondary" data-pagination="next">Next</button>
      `;
      mediaList.after(pagination);
      pagination.querySelector('[data-pagination="prev"]').addEventListener('click', () => {
        currentPage = Math.max(1, currentPage - 1);
        renderMediaItems();
      });
      pagination.querySelector('[data-pagination="next"]').addEventListener('click', () => {
        currentPage = Math.min(totalPages, currentPage + 1);
        renderMediaItems();
      });
    }

    if (pagination) {
      pagination.querySelector('.pagination-summary').textContent = `Page ${currentPage} of ${totalPages} (${filtered.length} item${filtered.length === 1 ? '' : 's'})`;
      pagination.querySelector('[data-pagination="prev"]').disabled = currentPage <= 1;
      pagination.querySelector('[data-pagination="next"]').disabled = currentPage >= totalPages;
    }
  }

  if (mediaSearch) {
    mediaSearch.addEventListener('input', () => {
      currentPage = 1;
      renderMediaItems();
    });
  }

  if (mediaSort) {
    mediaSort.addEventListener('change', () => {
      renderMediaItems();
    });
  }

  if (mediaList) {
    renderMediaItems();
  }

  const slides = Array.from(document.querySelectorAll('.hero-slider .slide'));
  if (slides.length) {
    let current = 0;
    setInterval(() => {
      slides[current].classList.remove('active');
      current = (current + 1) % slides.length;
      slides[current].classList.add('active');
    }, 5000);
  }
});
