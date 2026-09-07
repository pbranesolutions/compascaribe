import './style.css'

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href')
    if (href === '#') return
    
    e.preventDefault()
    const target = document.querySelector(href)
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    }
  })
})

// Simple entrance animation
document.addEventListener('DOMContentLoaded', () => {
  const hero = document.querySelector('.hero-content')
  if (hero) {
    hero.style.opacity = '0'
    hero.style.transform = 'translateY(20px)'
    hero.style.transition = 'opacity 0.8s ease, transform 0.8s ease'
    
    setTimeout(() => {
      hero.style.opacity = '1'
      hero.style.transform = 'translateY(0)'
    }, 100)
  }
})

// Intersection Observer for fade-in on scroll
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1'
      entry.target.style.transform = 'translateY(0)'
    }
  })
}, observerOptions)

// Observe sections for fade-in effect
document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.section')
  sections.forEach(section => {
    section.style.opacity = '0'
    section.style.transform = 'translateY(30px)'
    section.style.transition = 'opacity 0.6s ease, transform 0.6s ease'
    observer.observe(section)
  })
})
