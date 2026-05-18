import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { ethers } from 'ethers'
import type { Course } from './types'

// ✅ 引入老付刚给的最终版 Solidity ABI
import SkillBadgeABI from './abi/ABI.json' 

// ✅ 老付最新的智能合约主地址
const CONTRACT_ADDRESS = '0x01624B8478EAeA87F43C7e75aaD41999AA7bF59E'; 

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Home, BookOpen, ShoppingBag, User, Bell, CheckCircle2, Circle, TrendingUp, Target, Sparkles, CalendarDays, Zap, Camera, Trophy, Medal, Hexagon, Radio, Compass } from 'lucide-react'
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts'

function App() {
  const [activeTab, setActiveTab] = useState<'home' | 'library' | 'tasks' | 'mall' | 'profile'>('home') 
  const [userAddress, setUserAddress] = useState<string | null>(null);
  
  const [userPoints, setUserPoints] = useState(0); 
  const [earnHistory, setEarnHistory] = useState<any[]>([]); 
  const [redemptionHistory, setRedemptionHistory] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<Course[]>([]);
  const [mallItems, setMallItems] = useState<any[]>([]); 
  const [tasks, setTasks] = useState<any[]>([]);
  
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [globalActivities, setGlobalActivities] = useState<any[]>([]);
  const [sbtBadges] = useState<any[]>([]);

  const [loading, setLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [isViewingVideo, setIsViewingVideo] = useState(true) 
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMinting, setIsMinting] = useState(false)
  const [isTaskSubmitting, setIsTaskSubmitting] = useState(false)

  const [showNotifications, setShowNotifications] = useState(false); 
  const [hasUnread, setHasUnread] = useState(true); 
  const [chartView, setChartView] = useState<'week' | 'month'>('week'); 

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customAvatar, setCustomAvatar] = useState<string>(() => {
    return localStorage.getItem('userAvatar') || "https://github.com/shadcn.png";
  });

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setCustomAvatar(base64String);
        localStorage.setItem('userAvatar', base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEnterCourse = (course: Course) => {
    setSelectedCourse(course);
    setIsViewingVideo(true);
    setAnswers(new Array(course.questions?.length || 0).fill(""));
  };

  const syncDataFromRemote = async (address: string) => {
    if (!CONTRACT_ADDRESS || !(window as any).ethereum) return;

    try {
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, SkillBadgeABI, provider);

      // 1. 同步个人积分
      const userData = await contract.get_user_status(address);
      if (userData) {
         setUserPoints(Number(userData.total_points || 0));
      }

      // 2. 同步排行榜
      const topData = await contract.get_top_five();
      if (topData && topData.length > 0) {
         const parsedLeaderboard = topData.map((user: any) => ({
             address: user.account || user[0], 
             points: Number(user.points || user[1])
         }));
         setLeaderboard(parsedLeaderboard);
      }

      // 3. 缝合商城数据 (老付终于补齐了全量抓取接口 get_all_mall_items)
      try {
         const onChainItems = await contract.get_all_mall_items();
         
         // 过滤出 is_active 为 true 的商品
         const activeOnChainItems = onChainItems.filter((item: any) => item.is_active === true || item[2] === true);
         
         if (activeOnChainItems.length > 0) {
            // 拉取老孙的皮肉数据
            const metaRes = await axios.get('https://sun-metadata-server.local/api/mall_items');
            const offChainMetadata = metaRes.data; 

            const items = activeOnChainItems.map((item: any) => {
                const id = Number(item.item_id || item[0]);
                const price = Number(item.price || item[1]);
                const meta = offChainMetadata[id];
                return {
                    id: id,
                    points: price, // 严格以链上价格为准
                    name: meta?.name || `未知资产 #${id}`,
                    image: meta?.imageUrl || '' 
                };
            });
            setMallItems(items);
         }
      } catch (e) {
         console.debug("商城数据缝合被中断: 等待老孙元数据接入");
         setMallItems([]);
      }

      setHasUnread(true);
    } catch (err) {
      console.warn("❌ 链上状态拉取失败 (EVM)", err);
    }
  };

  useEffect(() => {
    if (userAddress) syncDataFromRemote(userAddress);
  }, [userAddress]);

  // 🔊 监听 EVM 底层出块事件 (Event)
  useEffect(() => {
    if (!CONTRACT_ADDRESS || !(window as any).ethereum) return;

    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, SkillBadgeABI, provider);

    const onCourseCompleted = (user: string, courseId: any, pointsGained: any) => {
      console.debug(`CourseID ${courseId.toString()}`);
      setGlobalActivities(prev => [{
        address: `${user.substring(0, 6)}...${user.substring(user.length - 4)}`,
        action: '完成极客挑战',
        points: pointsGained.toString()
      }, ...prev].slice(0, 10)); 
    };

    const onItemRedeemed = (user: string, itemId: any, cost: any) => {
      console.debug(`ItemID ${itemId.toString()}`);
      setGlobalActivities(prev => [{
        address: `${user.substring(0, 6)}...${user.substring(user.length - 4)}`,
        action: '在商城兑换权益',
        points: `-${cost.toString()}`
      }, ...prev].slice(0, 10));
    };

    // 🚀 新增监听：TaskCompleted 事件
    const onTaskCompleted = (user: string, taskId: any, pointsGained: any) => {
      console.debug(`TaskID ${taskId.toString()}`);
      setGlobalActivities(prev => [{
        address: `${user.substring(0, 6)}...${user.substring(user.length - 4)}`,
        action: '完成极客任务',
        points: pointsGained.toString()
      }, ...prev].slice(0, 10)); 
      if (userAddress) syncDataFromRemote(userAddress); // 任务完成刷新积分
    };

    contract.on("CourseCompleted", onCourseCompleted);
    contract.on("ItemRedeemed", onItemRedeemed);
    contract.on("TaskCompleted", onTaskCompleted);

    return () => { 
      contract.removeAllListeners("CourseCompleted");
      contract.removeAllListeners("ItemRedeemed");
      contract.removeAllListeners("TaskCompleted");
    };
  }, [userAddress]);

  const getWeeklyData = () => {
    const data = [];
    let cumulative = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
      
      const dailyPoints = earnHistory
        .filter((item: any) => new Date(item.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) === dateStr)
        .reduce((sum: number, item: any) => sum + item.reward, 0);
      
      cumulative += dailyPoints;
      data.push({ name: i === 0 ? '今日' : dateStr, points: cumulative });
    }
    return data;
  };

  const getMonthlyData = () => {
    const weeks = [0, 0, 0, 0];
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    earnHistory.forEach((item: any) => {
      const d = new Date(item.createdAt);
      if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) {
        const day = d.getDate();
        if (day <= 7) weeks[0] += item.reward;
        else if (day <= 14) weeks[1] += item.reward;
        else if (day <= 21) weeks[2] += item.reward;
        else weeks[3] += item.reward;
      }
    });

    return [
      { name: '第一周', points: weeks[0] },
      { name: '第二周', points: weeks[1] },
      { name: '第三周', points: weeks[2] },
      { name: '第四周', points: weeks[3] },
    ];
  };

  const calculateDailyCompletionRate = () => {
    if (tasks.length === 0) return '0%';
    const completedCount = tasks.filter(t => t.completed).length;
    return Math.round((completedCount / tasks.length) * 100) + '%';
  };

  const renderCalendar = () => {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const activeDays = new Set(
      earnHistory.map((h: any) => {
        const d = new Date(h.createdAt);
        if (d.getMonth() === currentMonth && d.getFullYear() === currentYear) return d.getDate();
        return null;
      }).filter(Boolean)
    );

    const days = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const isActive = activeDays.has(i);
      const isToday = i === today.getDate();
      days.push(
        <div 
          key={i} 
          className={`flex items-center justify-center h-8 rounded-lg text-xs font-black transition-all duration-300 ${
            isActive 
              ? 'bg-gradient-to-br from-purple-500 to-blue-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.6)]' 
              : isToday 
                ? 'border-2 border-purple-500 text-purple-400' 
                : 'bg-white/5 text-gray-600 hover:bg-white/10'
          }`}
        >
          {i}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-7 gap-2 mt-4">
        {['日', '一', '二', '三', '四', '五', '六'].map(d => (
          <div key={d} className="text-center text-[10px] text-gray-500 font-bold mb-2">{d}</div>
        ))}
        {days}
      </div>
    );
  };

  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      if (!(window as any).ethereum) {
        alert('🦊 请先安装 MetaMask (小狐狸) 插件钱包！');
        setIsConnecting(false);
        return;
      }
      
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      setUserAddress(address);
    } catch (error) {
      console.error("MetaMask 连接失败", error);
    } finally {
      setIsConnecting(false);
    }
  };

  // 统一从老孙的后端拉取元数据
  useEffect(() => {
    const fetchMetadataFromSun = async () => {
      setLoading(true);
      try {
        // 拉取课程
        const coursesRes = await axios.get('https://sun-metadata-server.local/api/courses');
        setRecommendations(coursesRes.data);
        
        // 拉取任务列表
        const tasksRes = await axios.get('https://sun-metadata-server.local/api/tasks');
        setTasks(tasksRes.data);
      } catch (error) {
        setRecommendations([]);
        setTasks([]);
      } finally { setLoading(false); }
    }
    fetchMetadataFromSun();
  }, [userAddress]);

  const handleSubmit = async () => {
    if (!userAddress || !CONTRACT_ADDRESS) return alert("请连接钱包并等待合约部署！");
    setIsSubmitting(true);
    
    try {
      const verifyRes = await axios.post('https://some-bees-hope.loca.lt/api/validate', 
        { 
          userAddress: userAddress,
          courseId: selectedCourse?.id,
          answers: answers 
        }, 
        { headers: { 'bypass-tunnel-reminder': 'true' } }
      );

      if(verifyRes.data && verifyRes.data.success !== false) {
         const { signature, score, correctRate } = verifyRes.data; 
         const courseId = selectedCourse?.id;
         const difficulty = selectedCourse?.difficulty;

         if (!signature || typeof score === 'undefined') {
           throw new Error("AI 预言机未返回合法的 signature 签名串");
         }

         const provider = new ethers.BrowserProvider((window as any).ethereum);
         const signer = await provider.getSigner();
         const contract = new ethers.Contract(CONTRACT_ADDRESS, SkillBadgeABI, signer);
         
         const tx = await contract.complete_course(courseId, score, correctRate, difficulty, signature);
         const receipt = await tx.wait();
         
         if (receipt.status === 1) {
             console.log(`✅ EVM 交易已入块: ${receipt.hash}`);
             syncDataFromRemote(userAddress); 
             setEarnHistory(prev => [
                 { title: selectedCourse?.title, reward: selectedCourse?.baseReward || 0, createdAt: new Date().toISOString() },
                 ...prev
             ]);
             setSelectedCourse(null);
             setIsSubmitting(false);
             alert(`🎉 恭喜！课程智能合约验签通过，成绩已上链！`);
         }
      } else {
         alert("❌ AI 验证未通过，检测到异常作答！");
         setIsSubmitting(false);
      }
    } catch (error) {
      console.error("链上交互失败:", error);
      alert("❌ 无法上链。原因可能为预言机未返回 signature，或网络拥堵。");
      setIsSubmitting(false);
    }
  };

  // 🚀 核心逻辑更新：任务系统的链上提交
  const handleCompleteTask = async (task: any) => {
    if (!userAddress || !CONTRACT_ADDRESS) return alert("请连接钱包！");
    setIsTaskSubmitting(true);

    try {
       // 1. 去老兰的预言机判定任务（签到/看视频时长），获取签名
       const verifyRes = await axios.post('https://some-bees-hope.loca.lt/api/validate_task', 
         { userAddress: userAddress, taskId: task.id },
         { headers: { 'bypass-tunnel-reminder': 'true' } }
       );

       if (verifyRes.data && verifyRes.data.success !== false) {
           const { reward_points, signature } = verifyRes.data;
           
           if (!signature || typeof reward_points === 'undefined') {
              throw new Error("老兰未返回 task signature 或 reward_points");
           }

           // 2. 拿到签名，去老付的合约要分
           const provider = new ethers.BrowserProvider((window as any).ethereum);
           const signer = await provider.getSigner();
           const contract = new ethers.Contract(CONTRACT_ADDRESS, SkillBadgeABI, signer);

           // 严丝合缝对齐 ABI: complete_task(task_id, reward_points, signature)
           const tx = await contract.complete_task(task.id, reward_points, signature);
           const receipt = await tx.wait();

           if (receipt.status === 1) {
               syncDataFromRemote(userAddress); // 刷新积分
               setTasks(tasks.map(t => t.id === task.id ? { ...t, completed: true, current: t.target } : t));
               setIsTaskSubmitting(false);
               alert(`🎉 恭喜！任务防伪验证通过，积分已发放！`);
           }
       } else {
           alert("❌ 任务未达标，预言机拒绝盖章！");
           setIsTaskSubmitting(false);
       }
    } catch (err) {
       console.error("任务上链失败:", err);
       alert("❌ 任务校验失败。老兰接口宕机或用户取消签名。");
       setIsTaskSubmitting(false);
    }
  };

  const handleRedeem = async (item: any) => {
    if (!userAddress || !CONTRACT_ADDRESS) return alert("请配置合约");
    
    if (userPoints >= item.points) {
      if (window.confirm(`确定花费 ${item.points} 积分兑换【${item.name}】吗？`)) {
        setIsMinting(true);
        try {
           const provider = new ethers.BrowserProvider((window as any).ethereum);
           const signer = await provider.getSigner();
           const contract = new ethers.Contract(CONTRACT_ADDRESS, SkillBadgeABI, signer);
           
           const tx = await contract.redeem_item(item.id);
           const receipt = await tx.wait();

           if (receipt.status === 1) {
              setIsMinting(false);
              syncDataFromRemote(userAddress);
              setRedemptionHistory(prev => [
                { itemName: item.name, cost: item.points, createdAt: new Date().toISOString() },
                ...prev
              ]);
              alert('✅ 兑换成功，EVM 合约已记录！');
           }
        } catch(err) {
           console.error(err);
           setIsMinting(false);
           alert('兑换异常');
        }
      }
    } else { alert('❌ 积分余额不足！'); }
  };

  const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString();

  return (
    <div className="flex h-screen bg-[#07080e] text-white font-sans overflow-hidden">
      
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee { animation: marquee 25s linear infinite; }
      `}</style>

      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleAvatarUpload} className="hidden" />

      <aside className="w-64 bg-[#0B0D14] border-r border-white/5 flex flex-col z-20 shadow-[10px_0_30px_rgba(0,0,0,0.5)] relative">
        <div className="p-8 flex items-center gap-3">
          <div className="relative">
             <div className="absolute inset-0 bg-purple-500 blur-md opacity-50"></div>
             <img src="/images/logo.png" alt="Logo" className="relative w-8 h-8 rounded-lg object-contain" />
          </div>
          <span className="text-2xl font-black tracking-tight text-white">SkillNet</span>
        </div>
        
        <nav className="flex-1 px-3 space-y-1 mt-4">
          {[
            { id: 'home', icon: Home, label: '首页' },
            { id: 'library', icon: BookOpen, label: '探索课程' },
            { id: 'tasks', icon: Target, label: '任务中心' },
            { id: 'mall', icon: ShoppingBag, label: '积分商城' },
            { id: 'profile', icon: User, label: '个人中心' }
          ].map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button 
                key={item.id}
                onClick={() => setActiveTab(item.id as any)} 
                className={`w-full group flex items-center gap-3 px-5 py-4 rounded-xl transition-all duration-300 relative overflow-hidden ${
                  isActive ? 'text-white bg-white/5 shadow-inner' : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-purple-500 rounded-r-full shadow-[0_0_10px_#a855f7]"></div>
                )}
                <Icon size={20} className={`relative z-10 transition-transform duration-300 ${isActive ? 'text-purple-400' : 'group-hover:scale-110'}`} /> 
                <span className={`relative z-10 font-bold tracking-wide ${isActive ? 'text-white' : ''}`}>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden bg-[#07080e]">
        
        <div className="absolute top-8 right-10 flex items-center gap-4 z-50 pointer-events-auto">
          <div className="relative">
             <button 
                onClick={() => setShowNotifications(!showNotifications)} 
                className="relative text-gray-300 hover:text-white transition-all p-2.5 rounded-xl bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 shadow-lg"
             >
               <Bell size={18} />
               {userAddress && hasUnread && <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-[#12131A]"></span>}
             </button>
             
             {showNotifications && (
               <div className="absolute right-0 mt-3 w-80 bg-[#1A1D27] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                 <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center bg-white/5">
                   <span className="text-sm font-bold text-white">系统通知</span>
                   <span 
                     className="text-xs text-purple-400 cursor-pointer hover:text-purple-300 transition-colors"
                     onClick={() => setHasUnread(false)}
                   >
                     全部已读
                   </span>
                 </div>
                 <div className="p-2 space-y-1">
                   {userAddress ? (
                     <div className="px-4 py-3 hover:bg-white/5 rounded-xl cursor-pointer transition-colors">
                       <p className="text-sm font-bold text-white mb-1 flex items-center gap-2"><CheckCircle2 size={14} className="text-green-400"/> 钱包连接成功</p>
                       <p className="text-xs text-gray-500">欢迎来到 SkillNet，您的链上旅程已开启。</p>
                     </div>
                   ) : (
                     <div className="px-4 py-8 text-center text-gray-500 text-sm">暂无新通知，请先连接 MetaMask 钱包。</div>
                   )}
                 </div>
               </div>
             )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-10 hide-scrollbar scroll-smooth relative z-0 mt-8">
          
          {activeTab === 'home' && (
            <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20 relative mt-4">
              
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-full max-w-3xl z-40 group [perspective:1000px] pointer-events-none">
                 <div className="flex items-center h-10 bg-black/40 backdrop-blur-xl border-t border-purple-500/30 border-b border-white/5 rounded-xl shadow-[0_15px_40px_rgba(168,85,247,0.15)] transition-all duration-700 ease-out [transform:rotateX(-20deg)_translateY(-10px)] group-hover:[transform:rotateX(0deg)_translateY(0deg)] pointer-events-auto overflow-hidden">
                    <div className="bg-purple-900/30 h-full px-4 flex items-center gap-2 border-r border-purple-500/20 shrink-0">
                      <Radio size={14} className="text-purple-400 animate-pulse" />
                      <span className="text-xs font-black tracking-widest text-purple-300">实时播报</span>
                    </div>
                    <div className="flex-1 relative flex items-center h-full">
                       {globalActivities.length > 0 ? (
                          <div className="animate-marquee whitespace-nowrap flex gap-12 items-center px-4 h-full">
                             {globalActivities.map((act, i) => (
                                <span key={i} className="text-[13px] font-mono text-gray-300 flex items-center gap-2">
                                   <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                   <span className="text-purple-400">{act.address}</span> 
                                   <span className="text-gray-400">{act.action}</span>
                                   <span className={`font-bold drop-shadow-[0_0_5px_rgba(74,222,128,0.4)] ${act.points.includes('-') ? 'text-red-400' : 'text-green-400'}`}>{act.points.includes('-') ? '' : '+'}{act.points} 积分</span>
                                </span>
                             ))}
                          </div>
                       ) : (
                          <div className="w-full text-center text-[12px] text-gray-500 font-mono tracking-widest">
                             [ 📡 EVM 事件监听已就绪。等待智能合约出块... ]
                          </div>
                       )}
                    </div>
                 </div>
              </div>

              <div className="bg-[#0F111A] rounded-[2.5rem] border border-white/5 relative shadow-2xl mb-12 mt-6 group [perspective:1000px]">
                <div className="transition-all duration-700 ease-out group-hover:shadow-[0_0_40px_rgba(168,85,247,0.1)]">
                  <div className="h-64 w-full rounded-t-[2.5rem] relative overflow-hidden bg-[#07080e]">
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[500px] h-[500px] bg-gradient-to-tr from-purple-900 via-blue-900 to-[#07080e] rounded-full blur-[2px] shadow-[0_0_150px_rgba(168,85,247,0.4)]"></div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[480px] h-[480px] bg-[#07080e] rounded-full"></div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[40%] w-[300px] h-[300px] bg-gradient-to-b from-purple-500/20 to-transparent rounded-full blur-2xl"></div>
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-50"></div>
                  </div>

                  <div className="absolute top-64 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10">
                      <div 
                        className="w-24 h-24 rounded-2xl bg-[#09090b] p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] border border-white/10 cursor-pointer relative" 
                        onClick={() => fileInputRef.current?.click()}
                      >
                          <Avatar className="w-full h-full rounded-xl hover:scale-105 transition-transform duration-300">
                            <AvatarImage src={customAvatar} className="object-cover" />
                            <AvatarFallback>User</AvatarFallback>
                          </Avatar>
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl opacity-0 hover:opacity-100 transition-opacity">
                             <Camera size={24} className="text-white" />
                          </div>
                      </div>
                      <p className="mt-4 font-black text-xl text-white drop-shadow-md flex items-center gap-2">
                          {userAddress ? `${userAddress.substring(0,6)}...${userAddress.substring(userAddress.length - 4)}` : '未连接极客'}
                          {userAddress && <CheckCircle2 size={16} className="text-blue-400" />}
                      </p>
                  </div>

                  <div className="pt-24 pb-10 px-6 sm:px-12 grid grid-cols-2 md:grid-cols-4 gap-6 divide-x divide-white/5 text-center items-center">
                      <div>
                         <p className="text-gray-500 text-xs font-mono mb-2 uppercase tracking-widest">总积分</p>
                         <p className="text-3xl font-black text-white">{userPoints}</p>
                      </div>
                      <div>
                         <p className="text-gray-500 text-xs font-mono mb-2 uppercase tracking-widest">今日任务完成率</p>
                         <p className="text-3xl font-black text-white">{calculateDailyCompletionRate()}</p>
                      </div>
                      <div>
                         <p className="text-gray-500 text-xs font-mono mb-2 uppercase tracking-widest">活跃日</p>
                         <p className="text-3xl font-black text-white">
                           {new Set(earnHistory.map(h => new Date(h.createdAt).toLocaleDateString())).size}
                         </p>
                      </div>
                      
                      <div className="flex flex-col items-center justify-center">
                         <button 
                           onClick={connectWallet} 
                           disabled={isConnecting}
                           className={`relative group outline-none ${!userAddress ? 'animate-pulse' : ''} hover:animate-none transition-all duration-300`}
                         >
                           <div className="absolute inset-0 bg-gradient-to-b from-purple-500 to-blue-600 rounded-xl blur opacity-60 group-hover:opacity-100 transition-opacity duration-300"></div>
                           <div className="relative px-6 py-3 bg-gradient-to-b from-[#1C1F2E] to-[#12141E] border-t border-white/20 border-b border-black/80 rounded-xl shadow-[0_8px_16px_rgba(0,0,0,0.6)] group-hover:-translate-y-1 group-hover:shadow-[0_15px_30px_rgba(168,85,247,0.4)] transition-all duration-300 flex items-center gap-3">
                             {userAddress ? (
                               <><div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div><span className="font-bold text-white text-sm">已连接节点</span></>
                             ) : (
                               <><Zap size={18} className="text-purple-400 group-hover:text-white transition-colors" /><span className="font-bold text-white text-sm drop-shadow-md">{isConnecting ? '连接中...' : '连接 MetaMask'}</span></>
                             )}
                           </div>
                         </button>
                      </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                
                <div className="group [perspective:1000px] h-[340px]">
                  <div className="w-full h-full bg-gradient-to-bl from-[#12141F] to-[#0A0C12] border border-white/10 rounded-[2rem] p-6 shadow-[15px_15px_30px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-500 ease-out [transform:rotateX(15deg)_rotateY(15deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_scale(1.02)] relative z-10">
                    <div className="flex items-center justify-between mb-6 shrink-0">
                       <h3 className="font-bold text-white flex items-center gap-2"><User size={16} className="text-purple-400"/> 今日任务</h3>
                    </div>
                    <div className="space-y-4 flex-1 overflow-hidden">
                      {tasks.length > 0 ? tasks.slice(0,3).map((task: any) => (
                        <div key={task.id} className="relative">
                          <div className="flex justify-between text-xs font-bold text-gray-300 mb-2">
                             <span>{task.label}</span>
                             <span className="text-purple-400">+{task.reward} 积分</span>
                          </div>
                          <div className="w-full h-1.5 bg-black/50 rounded-full overflow-hidden">
                             <div className={`h-full transition-all duration-1000 ${task.completed ? 'bg-green-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'}`} style={{ width: `${Math.min((task.current / task.target) * 100, 100)}%` }}></div>
                          </div>
                        </div>
                      )) : (
                        <div className="flex h-full items-center justify-center text-xs text-gray-600">等待管理端老孙皮肉数据...</div>
                      )}
                    </div>
                    <button onClick={() => setActiveTab('tasks')} className="w-full mt-6 bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm py-3 rounded-xl transition-all shadow-lg shadow-purple-600/20 shrink-0 relative z-20 pointer-events-auto">
                      前往任务中心
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-2 group [perspective:1000px] h-[340px]">
                  <div className="w-full h-full bg-[#0F111A] border border-white/5 rounded-[2rem] p-6 flex flex-col transition-all duration-500 ease-out group-hover:scale-[1.03] group-hover:shadow-[0_0_50px_rgba(168,85,247,0.2)] group-hover:border-purple-500/30 relative z-20">
                    <div className="flex justify-between items-center mb-6 shrink-0 relative z-30">
                      <h3 className="font-bold text-white flex items-center gap-2"><TrendingUp size={16} className="text-purple-400"/> 学习积分趋势</h3>
                      <div className="flex gap-2">
                        <span onClick={() => setChartView('week')} className={`text-xs px-3 py-1 rounded cursor-pointer transition-colors ${chartView === 'week' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}`}>本周</span>
                        <span onClick={() => setChartView('month')} className={`text-xs px-3 py-1 rounded cursor-pointer transition-colors ${chartView === 'month' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}`}>全部(全月)</span>
                      </div>
                    </div>
                    <div className="flex items-baseline gap-3 mb-4 shrink-0">
                       <span className="text-3xl font-black">{userPoints}</span>
                       <span className="text-sm font-bold text-gray-500">积分</span>
                    </div>
                    <div className="flex-1 w-full min-h-0 pointer-events-none group-hover:pointer-events-auto">
                      <ResponsiveContainer width="100%" height="100%">
                        {chartView === 'week' ? (
                          <AreaChart data={getWeeklyData()}>
                            <defs>
                              <linearGradient id="colorPoints" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ec4899" stopOpacity={0.6}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="lineColor" x1="0" y1="0" x2="1" y2="0">
                                 <stop offset="0%" stopColor="#3b82f6"/>
                                 <stop offset="50%" stopColor="#a855f7"/>
                                 <stop offset="100%" stopColor="#ec4899"/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis dataKey="name" stroke="#3f3f46" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis domain={[0, 500]} stroke="#3f3f46" fontSize={12} tickLine={false} axisLine={false} allowDataOverflow={true} />
                            <Tooltip contentStyle={{ backgroundColor: '#0F111A', border: '1px solid #ffffff10', borderRadius: '12px' }} />
                            <Area type="monotone" dataKey="points" stroke="url(#lineColor)" strokeWidth={4} fillOpacity={1} fill="url(#colorPoints)" />
                          </AreaChart>
                        ) : (
                          <BarChart data={getMonthlyData()}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis dataKey="name" stroke="#3f3f46" fontSize={12} tickLine={false} axisLine={false} />
                            <YAxis domain={[0, 5000]} stroke="#3f3f46" fontSize={12} tickLine={false} axisLine={false} allowDataOverflow={true} />
                            <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#0F111A', border: '1px solid #ffffff10', borderRadius: '12px' }} />
                            <Bar dataKey="points" fill="#a855f7" radius={[6, 6, 0, 0]} barSize={40} />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="group [perspective:1000px] h-[340px]">
                  <div className="w-full h-full bg-gradient-to-br from-[#12141F] to-[#0A0C12] border border-white/10 rounded-[2rem] p-6 shadow-[-15px_15px_30px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-500 ease-out [transform:rotateX(15deg)_rotateY(-15deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_scale(1.02)]">
                    <div className="flex justify-between items-center mb-6 shrink-0">
                      <h3 className="font-bold text-white flex items-center gap-2"><CalendarDays size={16} className="text-blue-400"/> 学习日历</h3>
                      <span className="text-[10px] text-gray-500 border border-white/10 px-2 py-0.5 rounded">本月</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-2 shrink-0">
                       <span className="text-2xl font-black text-white">{earnHistory.length}</span>
                       <span className="text-xs font-bold text-gray-500">累计学习次数</span>
                    </div>
                    <div className="flex-1 overflow-hidden mt-2">
                       {renderCalendar()}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                 
                 <div className="lg:col-span-1 group [perspective:1000px] h-[380px]">
                   <div className="w-full h-full bg-[#0F111A] border border-white/5 rounded-[2.5rem] p-8 shadow-[15px_15px_30px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-500 ease-out [transform:rotateX(15deg)_rotateY(15deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_scale(1.02)]">
                      <div className="flex justify-between items-center mb-6 shrink-0">
                         <h3 className="font-bold text-white flex items-center gap-2"><Trophy size={18} className="text-yellow-500"/> 全局极客榜</h3>
                         <span className="text-xs bg-white/5 text-gray-400 px-2 py-1 rounded">前 5 名</span>
                      </div>
                      <div className="space-y-4 flex-1 overflow-y-auto hide-scrollbar">
                         {leaderboard.length > 0 ? (
                           leaderboard.map((user, idx) => (
                             <div key={idx} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 hover:border-purple-500/30 transition-colors">
                               <div className="flex items-center gap-3">
                                 <span className={`font-black text-lg w-6 ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-orange-400' : 'text-gray-600'}`}>#{idx + 1}</span>
                                 <span className="font-mono text-sm text-gray-200">{`${user.address.substring(0,6)}...${user.address.substring(user.address.length-4)}`}</span>
                               </div>
                               <span className="text-purple-400 font-bold text-sm">{user.points} 积分</span>
                             </div>
                           ))
                         ) : (
                           <div className="h-full flex flex-col items-center justify-center py-10 text-gray-500 text-sm border border-dashed border-gray-800 rounded-2xl bg-white/5">
                              <Trophy size={32} className="mb-3 opacity-30 text-gray-600 animate-pulse" />
                              <p>{CONTRACT_ADDRESS ? '排行榜暂无数据' : '缺少合约配置'}</p>
                           </div>
                         )}
                      </div>
                   </div>
                 </div>

                 <div className="lg:col-span-2 group [perspective:1000px] h-[380px]">
                   <div className="w-full h-full bg-gradient-to-br from-[#12141F] to-[#0A0C12] border border-white/10 rounded-[2.5rem] p-8 shadow-[-15px_15px_30px_rgba(0,0,0,0.5)] flex flex-col transition-all duration-500 ease-out [transform:rotateX(15deg)_rotateY(-15deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_scale(1.02)] relative overflow-hidden">
                      <div className="flex justify-between items-center mb-6 shrink-0 relative z-10">
                        <h3 className="font-bold text-white flex items-center gap-2"><Zap size={18} className="text-purple-400"/> 极客链上能量阵</h3>
                        <span className="text-xs bg-white/5 text-gray-400 px-2 py-1 rounded border border-white/5">
                            {CONTRACT_ADDRESS ? 'EVM 直连中' : '离线空转'}
                        </span>
                      </div>
                      
                      <div className="flex-1 flex items-center justify-center relative">
                         <div className="absolute w-48 h-48 border-[2px] border-purple-500/40 rounded-full animate-[spin_4s_linear_infinite] [transform:rotateX(70deg)] shadow-[0_0_20px_rgba(168,85,247,0.3)]"></div>
                         <div className="absolute w-64 h-64 border-[2px] border-blue-500/30 rounded-full animate-[spin_7s_linear_infinite_reverse] [transform:rotateX(70deg)_rotateY(20deg)] shadow-[0_0_20px_rgba(59,130,246,0.3)]"></div>
                         <div className="absolute w-32 h-32 bg-gradient-to-t from-purple-600/30 to-blue-500/30 blur-2xl rounded-full animate-pulse"></div>
                         
                         <div className="relative z-10 flex flex-col items-center">
                            <Sparkles size={28} className="text-purple-400 mb-2 drop-shadow-[0_0_10px_rgba(168,85,247,1)]" />
                            <p className="text-4xl font-black text-white tracking-widest drop-shadow-md">
                               {userPoints > 0 ? userPoints : 'AWAITING'}
                            </p>
                            <p className="text-xs text-gray-400 font-mono mt-2 tracking-widest">
                               {userPoints > 0 ? 'ON-CHAIN POWER' : 'EVM SYNC'}
                            </p>
                         </div>
                      </div>
                   </div>
                 </div>
              </div>

              <div className="group [perspective:1500px]">
                <div className="bg-[#0F111A] border border-white/5 rounded-[2.5rem] p-10 shadow-[0_20px_40px_rgba(0,0,0,0.5)] mt-8 transition-all duration-500 ease-out [transform:rotateX(10deg)] group-hover:[transform:rotateX(0deg)]">
                   <div className="flex justify-between items-center mb-8">
                      <h3 className="font-bold text-white flex items-center gap-2 text-xl"><Compass size={22} className="text-purple-400"/> 为你专属推荐</h3>
                      <button onClick={() => setActiveTab('library')} className="text-sm font-bold text-gray-400 hover:text-white bg-white/5 px-6 py-2.5 rounded-xl transition-colors">
                        进入课程海库
                      </button>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                      {loading ? (
                         <div className="col-span-full py-16 text-center text-gray-500 text-sm border border-dashed border-gray-800 rounded-2xl bg-white/5 animate-pulse">
                            数据链路拉取中...
                         </div>
                      ) : recommendations.length > 0 ? (
                         recommendations.slice(0, 4).map((course: any, idx: number) => (
                            <div key={idx} onClick={() => handleEnterCourse(course)} className="bg-gradient-to-br from-white/5 to-[#1A1D27] p-6 rounded-2xl border border-white/5 hover:border-purple-500/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)] transition-all cursor-pointer hover:-translate-y-1 flex flex-col h-full">
                               <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-4 transition-transform hover:scale-110">
                                  <Sparkles size={20} className="text-purple-400"/>
                               </div>
                               <h4 className="font-bold text-base text-gray-200 hover:text-white mb-2 flex-grow">{course.title}</h4>
                               <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                                 <span className="text-xs text-gray-500">难度 Lvl.{course.difficulty}</span>
                                 <span className="text-xs text-green-400 font-mono font-bold bg-green-500/10 px-2 py-1 rounded">+{course.baseReward} 积分</span>
                               </div>
                            </div>
                         ))
                      ) : (
                         <div className="col-span-full py-16 text-center text-gray-500 text-sm border border-dashed border-gray-800 rounded-2xl bg-white/5">
                            <Hexagon size={40} className="mx-auto mb-3 opacity-30 text-gray-600" />
                            <p>链下元数据未注入，前端空转状态。</p>
                         </div>
                      )}
                   </div>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'tasks' && (
             <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-8 duration-500 pb-20">
                <div className="flex items-center gap-4 mb-10">
                   <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/30">
                     <Target size={32} className="text-white" />
                   </div>
                   <div>
                     <h2 className="text-4xl font-black text-white">极客任务与成就大厅</h2>
                     <p className="text-gray-400 mt-2">完成所有挑战，解锁专属于你的 Web3 灵魂绑定徽章 (SBT)</p>
                   </div>
                </div>

                <div className="bg-[#0F111A] border border-white/5 rounded-[2.5rem] p-10 shadow-2xl">
                  <h3 className="text-xl font-bold mb-8 flex justify-between items-center border-b border-white/5 pb-4">
                    <span>🔥 每日悬赏令</span>
                    <span className="text-sm font-mono bg-purple-500/10 text-purple-400 px-3 py-1 rounded-lg border border-purple-500/20">每日 00:00 刷新</span>
                  </h3>
                  
                  <div className="space-y-4">
                    {tasks.length > 0 ? tasks.map((task: any) => (
                      <div key={task.id} className={`p-6 rounded-2xl border transition-all ${task.completed ? 'bg-green-500/5 border-green-500/20 opacity-70' : 'bg-[#1A1D27] border-white/5 hover:border-purple-500/30'}`}>
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-4">
                            {task.completed ? <CheckCircle2 size={24} className="text-green-500" /> : <Circle size={24} className="text-gray-600" />}
                            <div>
                              <span className={`text-lg font-bold block ${task.completed ? 'text-gray-400' : 'text-white'}`}>{task.label}</span>
                              <span className="text-xs text-gray-500 mt-1 font-mono">进度: {task.current} / {task.target}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-lg font-black text-purple-400 bg-purple-500/10 px-4 py-1.5 rounded-xl border border-purple-500/20">
                              💎 +{task.reward}
                            </span>
                            {!task.completed && (
                              <button 
                                disabled={isTaskSubmitting}
                                onClick={() => handleCompleteTask(task)} 
                                className="bg-white/5 hover:bg-white/10 text-sm font-bold text-gray-300 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                              >
                                {isTaskSubmitting ? '验签中...' : '提交验证'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="w-full h-2 bg-[#09090b] rounded-full overflow-hidden shadow-inner">
                          <div className={`h-full transition-all duration-1000 ${task.completed ? 'bg-green-500' : 'bg-gradient-to-r from-purple-600 to-blue-500'}`} style={{ width: `${Math.min((task.current / task.target) * 100, 100)}%` }}></div>
                        </div>
                      </div>
                    )) : (
                      <div className="py-16 text-center text-gray-500 text-sm border border-dashed border-gray-800 rounded-2xl bg-white/5">
                         等待老孙的链下元数据 API 注入任务...
                      </div>
                    )}
                  </div>
                </div>
             </div>
          )}

          {activeTab === 'library' && (
             <div className="max-w-5xl mx-auto pb-20 animate-in fade-in duration-500">
                <h2 className="text-4xl font-black mb-10 text-center">Web3 技能演进树</h2>
                
                <div className="relative flex flex-col items-center py-10 min-h-[400px]">
                   <div className="absolute top-0 bottom-0 w-1 bg-gradient-to-b from-purple-600/50 via-blue-500/50 to-transparent"></div>
                   
                   {loading ? (
                     <div className="z-10 bg-[#0F111A] p-6 rounded-2xl border border-purple-500/50 animate-pulse text-purple-400 font-mono text-sm mt-20">
                       [ AI 预言机计算中，正在为您生成最佳学习路径... ]
                     </div>
                   ) : recommendations.length > 0 ? (
                     recommendations.map((course: any, idx: number) => (
                        <div key={idx} className={`relative flex items-center w-full my-8 ${idx % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                           <div className={`absolute top-1/2 w-1/2 h-[2px] bg-purple-500/30 ${idx % 2 === 0 ? 'right-1/2' : 'left-1/2'}`}></div>
                           
                           <div onClick={() => handleEnterCourse(course)} className="z-10 w-[45%] bg-[#1A1D27] border border-white/10 p-6 rounded-2xl hover:border-purple-500 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)] transition-all cursor-pointer group">
                             <h3 className="font-bold text-lg text-white group-hover:text-purple-300 mb-2">{course.title}</h3>
                             <div className="flex justify-between items-center mt-4">
                                <span className="text-xs text-gray-500 font-mono">等级 Lvl.{course.difficulty}</span>
                                <span className="text-xs font-black text-green-400 bg-green-500/10 px-2 py-1 rounded">+{course.baseReward} 积分</span>
                             </div>
                           </div>
                           
                           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-purple-500 rounded-full border-4 border-[#07080e] shadow-[0_0_10px_#a855f7] z-20"></div>
                        </div>
                     ))
                   ) : (
                     <div className="z-10 bg-[#0F111A] border border-dashed border-gray-700 p-10 rounded-3xl text-center mt-20">
                        <Hexagon size={48} className="mx-auto text-gray-600 mb-4" />
                        <p className="text-gray-500">技能树尚未解锁。等待链下元数据下发。</p>
                     </div>
                   )}
                </div>
             </div>
          )}

          {activeTab === 'mall' && (
             <div className="max-w-7xl mx-auto pb-20">
                <h2 className="text-4xl font-black mb-10">积分商城</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-10 p-4">
                   {mallItems.length > 0 ? mallItems.map((item: any) => (
                     <div key={item.id} className="relative group [perspective:1500px]">
                        <div className="h-[340px] w-full bg-gradient-to-br from-white/10 to-[#ffffff05] backdrop-blur-xl border border-white/20 rounded-3xl p-5 flex flex-col transition-all duration-700 ease-out shadow-[-20px_20px_30px_rgba(0,0,0,0.5)] group-hover:shadow-[0_0_50px_rgba(168,85,247,0.4)] [transform:rotateX(20deg)_rotateY(-20deg)] group-hover:[transform:rotateX(0deg)_rotateY(0deg)_scale(1.05)]">
                           <div className="h-40 rounded-2xl overflow-hidden mb-4 relative shadow-inner">
                              {item.image ? (
                                <img src={item.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
                              ) : (
                                <div className="w-full h-full bg-gray-900 flex items-center justify-center text-xs text-gray-500">图片缺失</div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/90 via-transparent to-transparent opacity-80"></div>
                           </div>
                           <h4 className="text-base font-bold mb-1 truncate text-gray-200 group-hover:text-white transition-colors drop-shadow-md">{item.name}</h4>
                           <div className="flex justify-between items-center mt-auto pt-4 border-t border-white/10">
                              <span className="text-purple-400 font-black text-sm bg-purple-500/10 px-3 py-1.5 rounded-lg border border-purple-500/20 shadow-inner">
                                💎 {item.points}
                              </span>
                              <button disabled={isMinting} onClick={() => handleRedeem(item)} className="bg-white/5 hover:bg-purple-600 text-gray-300 hover:text-white px-5 py-2 rounded-xl text-xs font-bold transition-all border border-white/10 hover:border-purple-500 shadow-lg">
                                {isMinting ? '兑换中...' : '链上兑换'}
                              </button>
                           </div>
                        </div>
                     </div>
                   )) : (
                     <div className="col-span-full py-16 text-center text-gray-500 text-sm border border-dashed border-gray-800 rounded-2xl bg-white/5">
                        等待老孙配置管理端皮肉 API，与链上库存进行骨肉缝合...
                     </div>
                   )}
                </div>
             </div>
          )}

          {activeTab === 'profile' && (
             <div className="max-w-5xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 pb-20">
                <h2 className="text-4xl font-black mb-10">个人成就中心</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                   <div className="bg-[#0F111A] border border-white/5 rounded-[2.5rem] p-10 shadow-2xl">
                      <h3 className="font-bold mb-8 text-gray-400 flex items-center gap-3 text-lg">
                         <BookOpen size={20} className="text-purple-400" /> 链上学习记录
                      </h3>
                      <div className="space-y-4">
                        {earnHistory.length === 0 ? (
                           <div className="p-10 text-center border border-dashed border-gray-800 rounded-[1.5rem] bg-white/5">
                             <p className="text-gray-500">暂无链上记录</p>
                           </div>
                        ) : earnHistory.map((h: any, i: number) => (
                          <div key={i} className="bg-[#1A1D27] p-5 rounded-2xl border border-white/5 flex justify-between items-center hover:border-purple-500/30 transition-colors">
                             <div>
                                <p className="font-bold text-sm text-gray-200">{h.title}</p>
                                <p className="text-xs text-gray-500 mt-1 font-mono">{formatDate(h.createdAt)}</p>
                             </div>
                             <span className="text-green-400 font-black text-lg bg-green-500/10 px-3 py-1 rounded-lg">+{h.reward}</span>
                          </div>
                        ))}
                      </div>
                   </div>
                   
                   <div className="bg-[#0F111A] border border-white/5 rounded-[2.5rem] p-10 shadow-2xl">
                      <h3 className="font-bold mb-8 text-gray-400 flex items-center gap-3 text-lg">
                         <ShoppingBag size={20} className="text-purple-400" /> 权益兑换历史
                      </h3>
                      <div className="space-y-4">
                        {redemptionHistory.length === 0 ? (
                           <div className="p-10 text-center border border-dashed border-gray-800 rounded-[1.5rem] bg-white/5">
                             <p className="text-gray-500">暂无链上兑换记录</p>
                           </div>
                        ) : redemptionHistory.map((r: any, i: number) => (
                          <div key={i} className="bg-[#1A1D27] p-5 rounded-2xl border border-white/5 flex justify-between items-center hover:border-red-500/30 transition-colors">
                             <div>
                                <p className="font-bold text-sm text-gray-200">{r.itemName}</p>
                                <p className="text-xs text-gray-500 mt-1 font-mono">{formatDate(r.createdAt)}</p>
                             </div>
                             <span className="text-red-400 font-black text-lg bg-red-500/10 px-3 py-1 rounded-lg">-{r.cost}</span>
                          </div>
                        ))}
                      </div>
                   </div>
                </div>

                <div className="bg-gradient-to-b from-[#12141F] to-[#0A0C12] border border-white/5 rounded-[2.5rem] p-10 shadow-2xl mt-10">
                   <h3 className="font-bold mb-8 text-white flex items-center gap-3 text-xl">
                      <Medal size={24} className="text-yellow-400" /> 灵魂绑定徽章 (SBT) 藏品柜
                   </h3>
                   <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                      {sbtBadges.length > 0 ? (
                         sbtBadges.map((badge, idx) => (
                            <div key={idx} className="bg-white/5 border border-purple-500/30 rounded-2xl p-6 flex flex-col items-center shadow-[0_0_20px_rgba(168,85,247,0.2)] hover:-translate-y-2 transition-transform cursor-pointer">
                               <Medal size={40} className="text-purple-400 mb-3" />
                               <span className="text-xs font-bold text-white text-center">{badge.name}</span>
                            </div>
                         ))
                      ) : (
                         <div className="col-span-full py-16 text-center border border-dashed border-white/10 rounded-3xl">
                            <Sparkles size={48} className="mx-auto text-gray-600 mb-4 opacity-50" />
                            <p className="text-gray-400 font-bold">藏品柜空空如也</p>
                            <p className="text-xs text-gray-600 mt-2">完成挑战，智能合约将为您空投不可篡改的 SBT 徽章。</p>
                         </div>
                      )}
                   </div>
                </div>
             </div>
          )}

        </div>
      </main>

      {selectedCourse && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-2xl flex items-center justify-center p-10 animate-in fade-in zoom-in-95 duration-300">
          <div className="bg-[#0F111A] border border-white/10 w-full max-w-5xl rounded-[3rem] p-12 relative h-[85vh] flex flex-col shadow-[0_0_50px_rgba(168,85,247,0.1)]">
             <button onClick={() => setSelectedCourse(null)} className="absolute top-8 right-8 text-gray-500 hover:text-white bg-white/5 hover:bg-red-500/80 p-3 rounded-full transition-all z-50">✕</button>
             <h2 className="text-3xl font-black mb-8 pr-16 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">{selectedCourse.title}</h2>
             
             <div className="flex-1 overflow-y-auto pr-4 hide-scrollbar">
                {isViewingVideo ? (
                  <div className="aspect-video bg-[#050505] rounded-[2rem] overflow-hidden border border-white/5 flex items-center justify-center shadow-2xl relative">
                    <video src={selectedCourse.videoUrl} controls autoPlay className="w-full h-full" />
                    {!selectedCourse.videoUrl && <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600"><BookOpen size={48} className="mb-4 opacity-30"/><p>等待链下视频流解析</p></div>}
                  </div>
                ) : (
                  <div className="space-y-6">
                     {selectedCourse.questions?.map((q: any, idx: number) => (
                       <div key={idx} className="bg-white/5 p-8 rounded-[2rem] border border-white/5 hover:border-purple-500/30 transition-colors">
                          <p className="text-xl font-bold mb-6 text-white flex gap-3"><span className="text-purple-400">Q{idx + 1}.</span> {q.question}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             {q.options?.map((opt: string, oIdx: number) => (
                               <button 
                                 key={oIdx} 
                                 onClick={() => { const n = [...answers]; n[idx] = opt; setAnswers(n); }}
                                 className={`p-5 rounded-2xl border text-left text-sm font-medium transition-all ${answers[idx] === opt ? 'border-purple-500 bg-purple-500/20 text-white shadow-[0_0_20px_rgba(168,85,247,0.2)]' : 'border-white/5 text-gray-400 hover:border-white/20 hover:bg-white/10'}`}
                               >
                                 {opt}
                               </button>
                             ))}
                          </div>
                       </div>
                     ))}
                  </div>
                )}
             </div>
             
             <div className="pt-8 mt-auto shrink-0">
                <button disabled={isSubmitting} onClick={isViewingVideo ? () => setIsViewingVideo(false) : handleSubmit} className="w-full py-5 rounded-2xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 font-black text-lg text-white shadow-lg shadow-purple-500/25 transition-all hover:scale-[1.02] disabled:opacity-50">
                   {isViewingVideo ? "✅ 视频学习完成，进入验证测验" : (isSubmitting ? "🚀 正在调起 MetaMask 进行签名..." : "🚀 唤起 MetaMask 提交 EVM 验签")}
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App