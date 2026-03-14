const slides = Array.from(document.querySelectorAll('.slide'));
const track = document.getElementById('slidesTrack');
const progressBar = document.getElementById('progressBar');
const slideCounter = document.getElementById('slideCounter');
const dots = Array.from(document.querySelectorAll('.dot'));
const particleField = document.getElementById('particleField');

const TOTAL_SLIDES = slides.length;
let currentSlide = 0;
let wheelLocked = false;
let touchStartY = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatCounter(index) {
  const now = String(index + 1).padStart(2, '0');
  const total = String(TOTAL_SLIDES).padStart(2, '0');
  return `${now} / ${total}`;
}

function updateActiveSlide(index) {
  slides.forEach((slide, i) => {
    slide.classList.toggle('active', i === index);
  });

  dots.forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });

  slideCounter.textContent = formatCounter(index);
  const progress = ((index + 1) / TOTAL_SLIDES) * 100;
  progressBar.style.width = `${progress}%`;
  track.style.transform = `translate3d(0, -${index * 100}vh, 0)`;
}

function goToSlide(index) {
  const target = clamp(index, 0, TOTAL_SLIDES - 1);
  if (target === currentSlide) {
    return;
  }

  currentSlide = target;
  updateActiveSlide(currentSlide);
}

function nextSlide() {
  goToSlide(currentSlide + 1);
}

function prevSlide() {
  goToSlide(currentSlide - 1);
}

function handleKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === ' ') {
    event.preventDefault();
    nextSlide();
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    prevSlide();
    return;
  }

  if (event.key === 'PageDown') {
    event.preventDefault();
    nextSlide();
    return;
  }

  if (event.key === 'PageUp') {
    event.preventDefault();
    prevSlide();
    return;
  }

  if (event.key === 'Home') {
    event.preventDefault();
    goToSlide(0);
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    goToSlide(TOTAL_SLIDES - 1);
  }
}

function handleWheel(event) {
  if (wheelLocked) {
    return;
  }

  if (Math.abs(event.deltaY) < 24) {
    return;
  }

  wheelLocked = true;

  if (event.deltaY > 0) {
    nextSlide();
  } else {
    prevSlide();
  }

  window.setTimeout(() => {
    wheelLocked = false;
  }, 620);
}

function handleTouchStart(event) {
  touchStartY = event.touches[0].clientY;
}

function handleTouchEnd(event) {
  if (touchStartY === null) {
    return;
  }

  const deltaY = touchStartY - event.changedTouches[0].clientY;
  touchStartY = null;

  if (Math.abs(deltaY) < 50) {
    return;
  }

  if (deltaY > 0) {
    nextSlide();
  } else {
    prevSlide();
  }
}

function createParticles(count = 36) {
  for (let i = 0; i < count; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'particle';

    const size = Math.random() * 4 + 1;
    const left = Math.random() * 100;
    const delay = Math.random() * 14;
    const duration = Math.random() * 16 + 12;

    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${left}%`;
    particle.style.animationDelay = `${delay}s`;
    particle.style.setProperty('--time', `${duration}s`);

    particleField.appendChild(particle);
  }
}

function initDotNavigation() {
  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const index = Number.parseInt(dot.dataset.slide, 10);
      goToSlide(index);
    });
  });
}

function init() {
  createParticles();
  initDotNavigation();
  updateActiveSlide(currentSlide);

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('wheel', handleWheel, { passive: true });
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
}

document.addEventListener('DOMContentLoaded', init);
