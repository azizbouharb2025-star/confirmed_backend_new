# Frontend Development Rules

## 🚀 Technology Requirements

### MANDATORY: Use Latest Versions
- **React**: 18.2+ (latest stable)
- **Tailwind CSS**: 3.4+ (latest stable)
- **TypeScript**: 5.0+ (strongly recommended)

### Modern UI Framework Stack
- **Next.js**: 14+ (App Router)
- **Framer Motion**: Latest (animations)
- **Headless UI**: Latest (accessible components)
- **Heroicons**: Latest (modern icons)

## 🎨 Design Philosophy

### Ultra-Modern Aesthetic
- **Glassmorphism**: Frosted glass effects with backdrop-blur
- **Neumorphism**: Subtle shadows and depth
- **Gradient Overlays**: Dynamic color transitions
- **Micro-interactions**: Smooth hover states and transitions
- **Dark Mode First**: Modern dark theme as primary

### Visual Excellence Standards
- **Typography**: Inter/Geist font families
- **Spacing**: Consistent 8px grid system
- **Colors**: Rich gradients with semantic meaning
- **Shadows**: Layered depth with multiple shadow levels
- **Borders**: Subtle glows and gradient borders

## 🔥 Mind-Blowing Features Required

### Interactive Elements
- **Real-time Data**: Live updating dashboards
- **Smooth Animations**: 60fps transitions everywhere
- **Gesture Support**: Swipe, pinch, drag interactions
- **Voice Commands**: Speech recognition integration
- **Haptic Feedback**: Subtle vibrations on mobile

### Advanced UI Components
- **3D Cards**: CSS transforms with perspective
- **Particle Systems**: Canvas-based background effects
- **Morphing Shapes**: SVG path animations
- **Floating Elements**: Magnetic cursor interactions
- **Parallax Scrolling**: Multi-layer depth effects

### Data Visualization
- **Chart.js/D3.js**: Interactive charts and graphs
- **Real-time Updates**: WebSocket data streaming
- **Animated Counters**: Number increment animations
- **Progress Rings**: Circular progress indicators
- **Heatmaps**: Color-coded data visualization

## 💫 Implementation Standards

### Performance Requirements
- **Core Web Vitals**: Perfect Lighthouse scores
- **Bundle Size**: < 100KB initial load
- **Lazy Loading**: All non-critical components
- **Image Optimization**: Next.js Image component
- **Code Splitting**: Route-based splitting

### Accessibility Excellence
- **WCAG 2.1 AA**: Full compliance
- **Keyboard Navigation**: Complete keyboard support
- **Screen Readers**: Semantic HTML and ARIA
- **Color Contrast**: 4.5:1 minimum ratio
- **Focus Management**: Visible focus indicators

### Responsive Design
- **Mobile First**: Design for mobile, enhance for desktop
- **Breakpoints**: sm:640px, md:768px, lg:1024px, xl:1280px, 2xl:1536px
- **Touch Targets**: Minimum 44px touch areas
- **Fluid Typography**: clamp() for responsive text
- **Container Queries**: Use @container for component-based responsive design

## 🎯 Dashboard Specific Requirements

### Layout Architecture
- **Sidebar Navigation**: Collapsible with icons and labels
- **Header Bar**: User profile, notifications, search
- **Main Content**: Grid-based widget system
- **Floating Panels**: Draggable and resizable widgets
- **Command Palette**: Cmd+K quick actions

### Interactive Widgets
- **Metric Cards**: Animated number displays with trends
- **Chart Widgets**: Interactive graphs with drill-down
- **Table Components**: Sortable, filterable, searchable
- **Calendar Views**: Drag-drop event management
- **Kanban Boards**: Task management with animations

### Real-time Features
- **Live Notifications**: Toast messages with animations
- **Status Indicators**: Pulsing dots for real-time status
- **Activity Feeds**: Live updating event streams
- **Chat Integration**: Real-time messaging
- **Collaborative Cursors**: Multi-user presence

## 🛠️ Required Dependencies

### Core Framework
```json
{
  "react": "^18.2.0",
  "next": "^14.0.0",
  "typescript": "^5.0.0",
  "tailwindcss": "^3.4.0"
}
```

### UI Enhancement
```json
{
  "framer-motion": "^10.0.0",
  "@headlessui/react": "^1.7.0",
  "@heroicons/react": "^2.0.0",
  "lucide-react": "^0.300.0"
}
```

### Data & State
```json
{
  "@tanstack/react-query": "^5.0.0",
  "zustand": "^4.4.0",
  "axios": "^1.6.0",
  "socket.io-client": "^4.7.0"
}
```

### Visualization
```json
{
  "recharts": "^2.8.0",
  "d3": "^7.8.0",
  "@visx/visx": "^3.0.0",
  "react-spring": "^9.7.0"
}
```

## 🎨 Tailwind Configuration

### Custom Theme Extensions
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          500: '#3b82f6',
          900: '#1e3a8a'
        },
        glass: 'rgba(255, 255, 255, 0.1)'
      },
      backdropBlur: {
        xs: '2px'
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s infinite'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio')
  ]
}
```

## 🚀 Mind-Blowing Examples

### Glassmorphism Card
```jsx
<div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl p-6 shadow-2xl hover:shadow-3xl transition-all duration-300">
  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-2xl" />
  <div className="relative z-10">
    {/* Content */}
  </div>
</div>
```

### Animated Metric Card
```jsx
<motion.div
  initial={{ scale: 0.9, opacity: 0 }}
  animate={{ scale: 1, opacity: 1 }}
  whileHover={{ scale: 1.02 }}
  className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-8 text-white shadow-2xl"
>
  <CountUp end={1250} duration={2} className="text-4xl font-bold" />
  <p className="text-indigo-100">Total Orders</p>
</motion.div>
```

### Interactive Chart Container
```jsx
<div className="bg-slate-900/50 backdrop-blur-2xl border border-slate-700/50 rounded-3xl p-6 hover:border-blue-500/50 transition-all duration-500">
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <defs>
        <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8}/>
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1}/>
        </linearGradient>
      </defs>
      <Line stroke="url(#gradient)" strokeWidth={3} />
    </LineChart>
  </ResponsiveContainer>
</div>
```

## ⚡ Performance Optimizations

### Code Splitting
```jsx
const DashboardWidget = lazy(() => import('./DashboardWidget'));
const AnalyticsPanel = lazy(() => import('./AnalyticsPanel'));
```

### Memoization
```jsx
const ExpensiveComponent = memo(({ data }) => {
  const processedData = useMemo(() => 
    data.map(item => ({ ...item, processed: true })), 
    [data]
  );
  
  return <div>{/* Render */}</div>;
});
```

## 🎯 Success Criteria

### Visual Impact
- ✅ Users say "WOW" within 3 seconds
- ✅ Smooth 60fps animations throughout
- ✅ Zero layout shifts or jank
- ✅ Instant perceived performance

### Technical Excellence
- ✅ Lighthouse score: 95+ on all metrics
- ✅ Bundle size under optimization targets
- ✅ Full TypeScript coverage
- ✅ Zero accessibility violations

### User Experience
- ✅ Intuitive navigation without training
- ✅ Responsive across all devices
- ✅ Real-time data updates
- ✅ Delightful micro-interactions

## 🔥 MANDATE: BLOW MINDS

Every component, every animation, every interaction must be crafted to create an "impossible" feeling - users should question if this is really a web application or some next-generation interface. The goal is to make competitors' dashboards look dated by comparison.

**NO COMPROMISES ON VISUAL EXCELLENCE.**