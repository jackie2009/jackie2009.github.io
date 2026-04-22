import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sword, Compass, Target, Heart, Shield, Swords, AlertCircle, RefreshCcw } from 'lucide-react';

// --- Types & Constants ---

type GameState = 'IDLE' | 'PLAYER_CUTTING' | 'PLAYER_ATTACKING' | 'ENEMY_ATTACKING' | 'GAME_OVER';

interface WeaponBar {
  id: string;
  type: 'Sword' | 'Spear' | 'Bow';
  x: number; // Percent of container width (0-100)
  width: number; // Percent of container width (0-100)
  originalWidth: number;
}

const WEAPONS = [
  { id: 'sword', type: 'Sword', icon: Sword, label: 'Short Sword', color: 'bg-rose-500' },
  { id: 'spear', type: 'Spear', icon: Compass, label: 'Spear', color: 'bg-emerald-500' },
  { id: 'bow', type: 'Bow', icon: Target, label: 'Bow', color: 'bg-amber-500' },
] as const;

const INITIAL_HP = 500;
const BOX_WIDTH = 100; // Symbolic units for the cutting logic

// --- Components ---

export default function App() {
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const [playerHP, setPlayerHP] = useState(INITIAL_HP);
  const [enemyHP, setEnemyHP] = useState(INITIAL_HP);
  const [bars, setBars] = useState<WeaponBar[]>([]);
  const [cutCount, setCutCount] = useState(0);
  const [scanPos, setScanPos] = useState(0);
  const [scanDirection, setScanDirection] = useState(1);
  const [damageResults, setDamageResults] = useState<{ weapon: string, multiplier: number }[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);

  const scanRef = useRef<number>(0);
  const requestRef = useRef<number | null>(null);

  // Initialize bars for a new round
  const resetBars = useCallback(() => {
    const newBars: WeaponBar[] = WEAPONS.map((w) => {
      const width = 50;
      const x = Math.random() * 50; // Randomly offset so it stays within 0-100
      return { id: w.id, type: w.type, x, width, originalWidth: width };
    });
    setBars(newBars);
    setCutCount(0);
  }, []);

  // Scan line movement
  const animateScan = useCallback(() => {
    setScanPos((prev) => {
      let next = prev + 1.2 * scanDirection; // Speed of scan
      if (next >= 100) {
        setScanDirection(-1);
        next = 100;
      } else if (next <= 0) {
        setScanDirection(1);
        next = 0;
      }
      scanRef.current = next;
      return next;
    });
    requestRef.current = requestAnimationFrame(animateScan);
  }, [scanDirection]);

  useEffect(() => {
    if (gameState === 'PLAYER_CUTTING') {
      requestRef.current = requestAnimationFrame(animateScan);
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, animateScan]);

  // Handle Game Start
  const startCombat = () => {
    setPlayerHP(INITIAL_HP);
    setEnemyHP(INITIAL_HP);
    setWinner(null);
    setGameState('PLAYER_CUTTING');
    resetBars();
  };

  // Handle Cutting Logic
  const handleCut = useCallback(() => {
    if (gameState !== 'PLAYER_CUTTING' || cutCount >= 3) return;

    const currentScan = scanRef.current;
    
    setBars((prevBars) => {
      return prevBars.map((bar) => {
        // If the cut line is within the bar's current range
        if (currentScan >= bar.x && currentScan <= bar.x + bar.width) {
          const leftLen = currentScan - bar.x;
          const rightLen = (bar.x + bar.width) - currentScan;

          if (leftLen < rightLen) {
            // Left is shorter
            return { ...bar, width: leftLen };
          } else {
            // Right is shorter
            return { ...bar, x: currentScan, width: rightLen };
          }
        }
        return bar;
      });
    });

    setCutCount((prev) => prev + 1);
    setFeedback("CUT!");
    setTimeout(() => setFeedback(null), 500);

    // If it was the last cut, proceed to attack
    if (cutCount === 2) {
      setTimeout(() => setGameState('PLAYER_ATTACKING'), 1000);
    }
  }, [gameState, cutCount]);

  // Listen for spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleCut();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCut]);

  const [shake, setShake] = useState(false);

  // Trigger screen shake
  const triggerShake = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 300);
  }, []);

  // Player Attack Logic
  useEffect(() => {
    if (gameState === 'PLAYER_ATTACKING') {
      const results = bars.map(bar => {
        const multiplier = Math.max(1, Math.round((50 / (bar.width || 0.1)) * 10) / 10);
        return { weapon: bar.type, multiplier };
      });
      setDamageResults(results);

      let currentEnemyHP = enemyHP;
      results.forEach((res, i) => {
        setTimeout(() => {
          const dmg = Math.floor(res.multiplier * 5);
          currentEnemyHP = Math.max(0, currentEnemyHP - dmg);
          setEnemyHP(currentEnemyHP);
          triggerShake();
          
          if (i === results.length - 1) {
            setTimeout(() => {
              if (currentEnemyHP <= 0) {
                 setGameState('GAME_OVER');
                 setWinner('Knight');
              } else {
                 setGameState('ENEMY_ATTACKING');
              }
            }, 800);
          }
        }, i * 600);
      });
    }
  }, [gameState, triggerShake]); // enemyHP removed from deps to prevent infinite loops, using a local tracker

  // Enemy Attack Logic
  useEffect(() => {
    if (gameState === 'ENEMY_ATTACKING') {
      setTimeout(() => {
        const dmg = (Math.floor(Math.random() * 15) + 10) * 5;
        const nextHP = Math.max(0, playerHP - dmg);
        setPlayerHP(nextHP);
        triggerShake();
        
        setTimeout(() => {
          if (nextHP <= 0) {
            setGameState('GAME_OVER');
            setWinner('Shadow Guard');
          } else {
            resetBars();
            setGameState('PLAYER_CUTTING');
          }
        }, 1000);
      }, 1200);
    }
  }, [gameState, triggerShake, resetBars]); // playerHP removed from fixed check

  return (
    <div className="h-screen w-full bg-dark-bg text-neutral-100 flex flex-col font-mono selection:bg-cyan-500 selection:text-white overflow-hidden relative">
      {/* Top Banner Decor */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent z-50" />

      {/* Hero Section (2/3) */}
      <section className="h-2/3 w-full relative flex items-center justify-around hero-gradient border-b border-white/10 overflow-hidden">
        {/* Header Overlay */}
        <div className="absolute top-8 left-0 right-0 text-center z-20 pointer-events-none">
          <h1 className="font-cinzel text-5xl tracking-[0.2em] text-white/90 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] uppercase">
            Knight's Gambit
          </h1>
          <p className="text-[10px] tracking-[0.8em] text-white/40 mt-3 uppercase font-mono">
            {gameState === 'IDLE' ? 'Protocol Idle // Standby' : `Turn Cycle // ${gameState.replace('_', ' ')}`}
          </p>
        </div>

        {/* Player Side */}
        <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div 
            animate={gameState === 'ENEMY_ATTACKING' ? { x: [-10, 10, -10, 10, 0] } : {}}
            className="w-64 h-80 bg-white/5 border border-white/10 rounded-xl relative overflow-hidden flex flex-col items-center justify-center backdrop-blur-md"
          >
            <div className="w-32 h-32 rounded-full border-2 border-cyan-500/30 flex items-center justify-center mb-8 bg-cyan-500/5 relative">
              <div className="absolute inset-0 rounded-full bg-cyan-500/10 blur-xl animate-pulse" />
              <span className="text-6xl drop-shadow-lg">⚔️</span>
            </div>
            <div className="text-center w-full px-8">
              <p className="font-cinzel text-2xl text-cyan-400 tracking-wider">SIR ALARIC</p>
              <div className="w-full h-1.5 bg-neutral-800 rounded-full mt-4 overflow-hidden shadow-inner">
                <motion.div 
                  className="h-full bg-cyan-500 shadow-[0_0_10px_theme(colors.cyan.500)]" 
                  initial={{ width: '100%' }}
                  animate={{ width: `${(playerHP / INITIAL_HP) * 100}%` }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] mt-2 opacity-50 font-mono">HP: {playerHP} / {INITIAL_HP}</p>
            </div>
          </motion.div>
        </div>

        <div className="text-6xl font-cinzel opacity-10 select-none">VS</div>

        {/* Enemy Side */}
        <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div 
            animate={gameState === 'PLAYER_ATTACKING' ? { scale: [1, 0.95, 1.05, 1] } : {}}
            className="w-64 h-80 bg-white/5 border border-white/10 rounded-xl relative overflow-hidden flex flex-col items-center justify-center backdrop-blur-md"
          >
            <div className="w-32 h-32 rounded-full border-2 border-red-500/30 flex items-center justify-center mb-8 bg-red-500/5 relative">
              <div className="absolute inset-0 rounded-full bg-red-500/10 blur-xl animate-pulse" />
              <span className="text-6xl drop-shadow-lg">👹</span>
            </div>
            <div className="text-center w-full px-8">
              <p className="font-cinzel text-2xl text-red-500 tracking-wider uppercase">V-FIEND</p>
              <div className="w-full h-1.5 bg-neutral-800 rounded-full mt-4 overflow-hidden shadow-inner direction-rtl">
                <motion.div 
                  className="h-full bg-red-600 shadow-[0_0_10px_theme(colors.red.600)] ml-auto" 
                  initial={{ width: '100%' }}
                  animate={{ width: `${(enemyHP / INITIAL_HP) * 100}%` }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                />
              </div>
              <p className="text-[10px] mt-2 opacity-50 font-mono">HP: {enemyHP} / {INITIAL_HP}</p>
            </div>
          </motion.div>
        </div>

        {/* Interaction Prompts */}
        <div className="absolute bottom-12 left-0 right-0 flex justify-center z-20">
          <AnimatePresence mode="wait">
            {gameState === 'IDLE' && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={startCombat}
                className="px-12 py-4 bg-white text-neutral-900 rounded-sm font-cinzel font-black uppercase tracking-[0.3em] hover:bg-cyan-500 hover:text-white transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)]"
              >
                Engage Duel
              </motion.button>
            )}
            {gameState === 'PLAYER_ATTACKING' && (
               <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-12"
               >
                 {damageResults.map((res, i) => (
                    <div key={i} className="flex flex-col items-center">
                       <span className="text-[10px] uppercase opacity-40 mb-1">{res.weapon}</span>
                       <span className="text-4xl font-cinzel text-white">x{res.multiplier}</span>
                    </div>
                 ))}
               </motion.div>
            )}
            {gameState === 'GAME_OVER' && (
              <motion.div className="flex flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h2 className="text-4xl font-cinzel text-cyan-400 mb-4 tracking-[0.2em]">{winner?.toUpperCase()} VICTORIOUS</h2>
                <button onClick={startCombat} className="text-xs tracking-widest text-white/50 hover:text-white uppercase flex items-center gap-2">
                  <RefreshCcw className="w-3 h-3" /> Re-Initialize Protocol
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Console Section (1/3) */}
      <section className="h-1/3 w-full bg-console-bg p-10 flex flex-col gap-6 relative">
        <div className="flex justify-between items-end px-4 mb-2 z-10">
          <div className="flex gap-12">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase opacity-40 tracking-widest mb-1">Action Sync</span>
              <span className="text-2xl font-bold text-white tracking-tighter">SLICE {cutCount} / 3</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase opacity-40 tracking-widest mb-1">Input Override</span>
              <span className="text-2xl font-bold text-white tracking-tighter">[SPACE] TO CUT</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase opacity-40 tracking-widest mb-1">Projection Magnitude</span>
            <div className="text-5xl font-cinzel text-white flex items-baseline gap-2">
              x{(bars.reduce((acc, b) => acc + (Math.max(1, Math.round((50 / (b.width || 0.1)) * 10) / 10)), 0) / 3).toFixed(1)}
              <span className="text-sm opacity-30 uppercase font-mono">AVG</span>
            </div>
          </div>
        </div>

        {/* The Cutting Box */}
        <div className="relative flex-grow w-full bg-black/40 rounded-xl border border-white/5 overflow-hidden flex flex-col justify-around p-6 backdrop-blur-sm group">
          {/* Scan Line */}
          {gameState === 'PLAYER_CUTTING' && (
            <motion.div 
              className="absolute top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-white to-transparent z-30 shadow-[0_0_15px_rgba(255,255,255,0.8)]"
              style={{ left: `${scanPos}%` }}
            />
          )}

          {/* Grid Lines Overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:40px_40px]" />

          {/* Weapon Rows */}
          {bars.map((bar) => {
            const weaponConfig = WEAPONS.find(w => w.type === bar.type);
            const colorClass = bar.type === 'Sword' ? 'border-cyan-400 weapon-glow-cyan' 
                             : bar.type === 'Spear' ? 'border-yellow-400 weapon-glow-yellow' 
                             : 'border-fuchsia-400 weapon-glow-fuchsia';
            const accentColor = bar.type === 'Sword' ? 'bg-cyan-400' : bar.type === 'Spear' ? 'bg-yellow-400' : 'bg-fuchsia-400';
            const shadowClass = bar.type === 'Sword' ? 'shadow-weapon-cyan' : bar.type === 'Spear' ? 'shadow-weapon-yellow' : 'shadow-weapon-fuchsia';

            return (
              <div key={bar.id} className={`flex items-center gap-8 h-12 bg-white/[0.02] pr-8 relative transition-all duration-300 border-l-4 ${colorClass}`}>
                <div className="w-20 flex justify-center text-3xl drop-shadow-lg scale-110">
                  {bar.type === 'Sword' ? '🗡️' : bar.type === 'Spear' ? '🔱' : '🏹'}
                </div>
                <div className="flex-1 h-8 bg-black/60 rounded-sm relative overflow-hidden ring-1 ring-white/5">
                  <motion.div
                    layout
                    className={`absolute h-full energy-bar-segment border-x border-white/20 z-10`}
                    style={{ left: `${bar.x}%`, width: `${bar.width}%` }}
                  >
                    <div className={`absolute right-0 top-0 h-full w-[2px] ${accentColor} shadow-[0_0_8px_currentColor]`} />
                  </motion.div>
                </div>
                <div className="w-32 text-right flex items-baseline justify-end gap-3">
                  <span className="text-[10px] opacity-30 font-bold uppercase tracking-widest">MAG</span>
                  <span className={`text-2xl font-bold font-mono ${accentColor.replace('bg-', 'text-')}`}>
                    x{(Math.max(1, Math.round((50 / (bar.width || 0.1)) * 10) / 10)).toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}

          {/* Feedback Overlay */}
          <AnimatePresence>
            {feedback && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.5 }}
                className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
              >
                <span className="font-cinzel text-7xl font-black text-white/20 tracking-[0.5em] italic">SYNC</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Meta */}
        <div className="absolute bottom-3 right-8 text-[10px] opacity-20 uppercase tracking-[0.5em] flex items-center gap-4">
          Tactical Interface Protocol // Engine Active
        </div>
      </section>
    </div>
  );
}
