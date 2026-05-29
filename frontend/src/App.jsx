import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  MapPin,
  Users,
  Search,
  Plus,
  ArrowRight,
  Lock,
  Unlock,
  CheckCircle,
  Info,
  Copy,
  User,
  AlertTriangle,
  RefreshCw,
  Eye,
  CheckSquare,
  Square,
  Calendar,
  Clock,
  CreditCard,
  UserCheck,
  AlertOctagon,
  Award,
  Bell
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:4000/api/v1';

const STANDARD_LOCATIONS = [
  "농장문", "누리관문", "텍문", "나리문", "동문", "정문", "수의대문", "쪽문", "조은문", "솔로문",
  "서문", "수영장문", "어린이집문", "북문", "보람관", "누리관", "첨성관", "향토관", "봉사관", "화목관"
];

const CATEGORIES = [
  { id: "식품", emoji: "🍎" },
  { id: "문구류", emoji: "✏️" },
  { id: "의류", emoji: "👕" },
  { id: "생활", emoji: "🧼" },
  { id: "뷰티", emoji: "💄" },
  { id: "도서", emoji: "📚" },
  { id: "기타", emoji: "📦" }
];

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"];

// Helpers for Timetable Slot Grouping and Sorting
const getSlotTimestamp = (slotKey) => {
  if (!slotKey) return 0;
  const [dayStr, timeStr] = slotKey.split('-');
  if (!dayStr || !timeStr) return 0;
  const [hourStr, minStr] = timeStr.split(':');

  const now = new Date();
  const currentDay = now.getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
  const targetDayIndex = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 }[dayStr];

  if (targetDayIndex === undefined) return 0;

  let diffDays = targetDayIndex - currentDay;
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + diffDays);
  targetDate.setHours(parseInt(hourStr, 10), parseInt(minStr, 10), 0, 0);

  if (targetDate.getTime() < now.getTime()) {
    targetDate.setDate(targetDate.getDate() + 7);
  }
  return targetDate.getTime();
};

const groupBookings = (bookings) => {
  const groups = {};
  bookings.forEach(b => {
    const key = `${b.slotKey}___${b.location}`;
    if (!groups[key]) {
      groups[key] = {
        slotKey: b.slotKey,
        location: b.location,
        members: []
      };
    }
    groups[key].members.push(b);
  });
  return Object.values(groups);
};

export default function App() {
  // Authentication & Simulation States
  const [currentUser, setCurrentUser] = useState(null);
  const [jwtToken, setJwtToken] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [activeTab, setActiveTab] = useState('board'); // 'board' | 'notifications' | 'mypage'

  // Hosted and Joined Posts States for strict participation filtering
  const [hostedPosts, setHostedPosts] = useState([]);
  const [joinedPosts, setJoinedPosts] = useState([]);

  // Auth form states
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authNickname, setAuthNickname] = useState('');
  const [authRefundAccount, setAuthRefundAccount] = useState('');
  const [authError, setAuthError] = useState('');

  // Notifications State
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // Main Posts State

  // Main Posts State
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [backendError, setBackendError] = useState('');

  // Filtering States
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Active Detail Modal/Page View
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [postDetail, setPostDetail] = useState(null);
  const [postMembers, setPostMembers] = useState([]);
  const [secureBankDetail, setSecureBankDetail] = useState(null);
  const [bankLoadingError, setBankLoadingError] = useState('');

  // Creation Modal State (supports multi-selection locations)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPost, setNewPost] = useState({
    title: '',
    link: '',
    category: '식품',
    locations: [], // Multi-selection array
    targetPrice: 30000,
    baseFee: 3000,
    autoConfirmFeeLimit: 1200,
    bankAccount: '',
    hostRealName: '',
    items: [{ itemName: '', itemPrice: '' }]
  });

  // Join Flow Modal State
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinConsent, setJoinConsent] = useState(false);
  const [joinItems, setJoinItems] = useState([{ itemName: '', itemPrice: '', quantity: 1 }]);

  // Timetable and Pickup scheduling states
  const [postBookings, setPostBookings] = useState([]);
  const [tempTimetableSlots, setTempTimetableSlots] = useState([]); // for host edits
  const [selectedPickupSlotKey, setSelectedPickupSlotKey] = useState(null);
  const [selectedPickupGate, setSelectedPickupGate] = useState('');

  // Copy success & Penalty notifications feedback
  const [copySuccess, setCopySuccess] = useState(false);
  const [penaltyAlert, setPenaltyAlert] = useState(null);

  // New Settlement & Rescue states
  const [hasDismissedConfirmedModal, setHasDismissedConfirmedModal] = useState({});
  const [isRescueModalOpen, setIsRescueModalOpen] = useState(false);
  const [rescueStrategy, setRescueStrategy] = useState('RE_OPEN'); // 'RE_OPEN' | 'SPLIT_REMAINING'
  const [rescueLoading, setRescueLoading] = useState(false);

  // Initialize: Load session from localStorage
  useEffect(() => {
    const token = localStorage.getItem('something_jwt');
    const userJson = localStorage.getItem('something_user');
    if (token && userJson) {
      setJwtToken(token);
      const userObj = JSON.parse(userJson);
      setCurrentUser(userObj);
      setNicknameInput(userObj.nickname);
    }
  }, []);

  const fetchNotifications = async () => {
    if (!jwtToken) return;
    try {
      const res = await fetch(`${API_BASE_URL}/notifications`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadNotificationsCount(data.filter(n => n.read === 0).length);
      }
    } catch (err) {

      const allNotifs = JSON.parse(localStorage.getItem('something_notifs') || '[]');
      const localNotifs = allNotifs.filter(n => n.userId === currentUser?.id);
      setNotifications(localNotifs);
      setUnreadNotificationsCount(localNotifs.filter(n => n.read === 0).length);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 8000);
      return () => clearInterval(interval);
    }
  }, [currentUser, jwtToken]);

  // Sync post lists on filters modification
  useEffect(() => {
    if (currentUser) {
      fetchPosts();
    }
  }, [selectedCategory, selectedLocations, currentUser]);

  // Sync details when a post is active
  useEffect(() => {
    if (selectedPostId) {
      fetchPostDetail(selectedPostId);
    } else {
      setPostDetail(null);
      setPostMembers([]);
      setSecureBankDetail(null);
      setPostBookings([]);
    }
  }, [selectedPostId]);

  const fetchMyPagePosts = async () => {
    if (!jwtToken) return;
    try {
      const hostedRes = await fetch(`${API_BASE_URL}/users/me/hosted`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (hostedRes.ok) {
        const hostedData = await hostedRes.json();
        setHostedPosts(hostedData);
      }

      const joinedRes = await fetch(`${API_BASE_URL}/users/me/joined`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (joinedRes.ok) {
        const joinedData = await joinedRes.json();
        setJoinedPosts(joinedData);
      }
    } catch (err) {

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');

      const hosted = localPosts.filter(p => p.hostId === currentUser?.id || p.hostNickname === currentUser?.nickname);
      setHostedPosts(hosted);

      const joined = localPosts.filter(p => {
        const members = JSON.parse(localStorage.getItem(`something_members_${p.id}`) || '[]');
        const isPart = members.some(m => m.userId === currentUser?.id);
        const isHost = p.hostId === currentUser?.id || p.hostNickname === currentUser?.nickname;
        return isPart && !isHost;
      });
      setJoinedPosts(joined);
    }
  };

  useEffect(() => {
    if (activeTab === 'mypage' && currentUser) {
      fetchMyPagePosts();
    }
  }, [activeTab, currentUser]);


  // Refresh User State periodically or on actions
  const refreshUserProfile = async () => {
    if (!currentUser) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/me`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data);
      }
    } catch (err) {

    }
  };

  // ----------------------------------------------------------------
  // Helper: Network Fetch Wrapper (Handles Failover Emulation)
  // ----------------------------------------------------------------
  const fetchPosts = async () => {
    setLoading(true);
    setBackendError('');
    try {
      let url = `${API_BASE_URL}/posts`;
      const queryParams = [];
      if (selectedCategory) queryParams.push(`category=${selectedCategory}`);
      if (selectedLocations && selectedLocations.length > 0) {
        queryParams.push(`location=${selectedLocations.join(',')}`);
      }
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error('서버 연결 실패');
      const data = await res.json();
      setPosts(data);
    } catch (err) {
      console.warn("Backend server offline, switching to N Thing?! local emulation mode.");
      setBackendError('몇띵?! 실시간 백엔드 서버(Port 4000) 오프라인 상태입니다. 로컬 프론트 에뮬레이터로 작동됩니다.');
      loadLocalFallbackPosts();
    } finally {
      setLoading(false);
    }
  };

  const loadLocalFallbackPosts = () => {
    const localPosts = localStorage.getItem('something_posts');
    if (!localPosts) {
      // Seed default local storage posts
      const defaults = [
        {
          id: "post_1",
          title: "[식품] 첨성관/향토관 같이 시켜요! 생수 2L 묶음배송",
          link: "https://coupang.com/water-bundle",
          category: "식품",
          locations: ["첨성관", "향토관", "정문"],
          targetPrice: 30000,
          baseFee: 3000,
          status: "OPEN",
          hostNickname: "침성관배고파",
          participantCount: 1,
          currentOrderAmount: 13000,
          remainingAmount: 17000,
          createdAt: Date.now() - 3600000
        },
        {
          id: "post_2",
          title: "[문구류] 텍문/나리문 무선제본 노트 10개 세트 띵",
          link: "https://smartstore.naver.com/notes",
          category: "문구류",
          locations: ["텍문", "나리문", "북문"],
          targetPrice: 20000,
          baseFee: 2500,
          status: "CONFIRMED",
          hostNickname: "정문치킨요정",
          participantCount: 3,
          currentOrderAmount: 21000,
          remainingAmount: 0,
          createdAt: Date.now() - 10800000
        }
      ];
      localStorage.setItem('something_posts', JSON.stringify(defaults));
      setPosts(defaults);
    } else {
      let list = JSON.parse(localPosts);
      if (selectedCategory) list = list.filter(p => p.category === selectedCategory);
      if (selectedLocations && selectedLocations.length > 0) {
        list = list.filter(p => p.locations.some(loc => selectedLocations.includes(loc)));
      }
      setPosts(list);
    }
  };

  const fetchPostDetail = async (postId) => {
    setBankLoadingError('');
    try {
      const detailRes = await fetch(`${API_BASE_URL}/posts/${postId}`);
      if (!detailRes.ok) throw new Error();
      const detailData = await detailRes.json();
      setPostDetail(detailData);
      setTempTimetableSlots(detailData.timetableSlots || []);

      const membersRes = await fetch(`${API_BASE_URL}/posts/${postId}/members`);
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        setPostMembers(membersData);
      }

      const bookingsRes = await fetch(`${API_BASE_URL}/posts/${postId}/pickup/bookings`);
      if (bookingsRes.ok) {
        const bookingsData = await bookingsRes.json();
        setPostBookings(bookingsData);
      }

      fetchSecureBankAccount(postId);

    } catch (err) {
      handleLocalFallbackDetail(postId);
    }
  };

  const handleLocalFallbackDetail = (postId) => {
    const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
    const post = localPosts.find(p => p.id === postId);
    if (!post) return;

    let mockMembers = [];
    if (postId === 'post_1') {
      mockMembers = [
        { userId: 'kakao_1', nickname: '침성관배고파', paymentStatus: 'APPROVED', items: [{ itemName: '쿠팡 생수 2L x 6개입', itemPrice: 6500, quantity: 2 }], individualTotal: 13000 }
      ];
    } else if (postId === 'post_2') {
      mockMembers = [
        { userId: 'naver_1', nickname: '정문치킨요정', paymentStatus: 'APPROVED', items: [{ itemName: '무선제본 무지 노트 A4', itemPrice: 12000, quantity: 1 }], individualTotal: 12000 },
        { userId: 'google_1', nickname: '쪽문배달왕', paymentStatus: 'SENT', sentAt: Date.now() - 3600000, items: [{ itemName: '무선제본 격자 노트 A4', itemPrice: 6000, quantity: 1 }], individualTotal: 6000 },
        { userId: 'kakao_2', nickname: '복현관지름신', paymentStatus: 'APPROVED', items: [{ itemName: '제본용 철제 스프링 고리', itemPrice: 3000, quantity: 1 }], individualTotal: 3000 }
      ];
    } else {
      const localMembers = localStorage.getItem(`something_members_${postId}`);
      mockMembers = localMembers ? JSON.parse(localMembers) : [];
    }

    const totalAccumulated = mockMembers.reduce((sum, m) => sum + m.individualTotal, 0);
    const participantCount = mockMembers.length || 1;
    const isFreeShippingMet = totalAccumulated >= post.targetPrice;
    const calculatedSplitFee = isFreeShippingMet ? 0 : Math.round((post.baseFee || 3000) / participantCount);

    // Load local bookings
    const localBookings = localStorage.getItem(`something_bookings_${postId}`);
    const bookings = localBookings ? JSON.parse(localBookings) : (
      postId === 'post_2' ? [{ id: 'b1', slotKey: 'Wed-10:00', location: '텍문', nickname: '복현관지름신', userId: 'kakao_2' }] : []
    );

    const postInfo = {
      ...post,
      participantCount,
      totalAccumulated,
      isFreeShippingMet,
      calculatedSplitFee,
      caseType: isFreeShippingMet ? "A" : "B"
    };

    setPostDetail(postInfo);
    setTempTimetableSlots(post.timetableSlots || (postId === 'post_2' ? ["Wed-10:00", "Wed-10:30", "Wed-11:00", "Thu-14:00", "Thu-14:30"] : []));
    setPostMembers(mockMembers);
    setPostBookings(bookings);

    if (post.status === 'CONFIRMED' || post.status === 'ARRIVED' || post.status === 'COMPLETED') {
      const isPart = mockMembers.some(m => m.userId === currentUser?.id) || post.hostNickname === currentUser?.nickname;
      if (isPart) {
        setSecureBankDetail({
          bankAccount: post.bankAccount || "카카오뱅크 3333-01-123456",
          hostMaskedName: post.hostMaskedName || "서*은"
        });
      } else {
        setBankLoadingError("🚫 UNAUTHORIZED: 참가 띵원만 열람 가능합니다.");
      }
    } else {
      setBankLoadingError("Locked until group buy is confirmed");
    }
  };

  const fetchSecureBankAccount = async (postId) => {
    setSecureBankDetail(null);
    setBankLoadingError('');
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${postId}/account`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      const data = await res.json();
      if (res.status === 403) {
        setBankLoadingError(data.error || "Locked");
      } else if (res.ok) {
        setSecureBankDetail(data);
      }
    } catch (err) {
      setBankLoadingError("Locked until group buy is confirmed");
    }
  };

  // ----------------------------------------------------------------
  // Production-Grade Auth Handlers & Refunds/Simulation API Calls
  // ----------------------------------------------------------------
  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authUsername || !authPassword || !authNickname) {
      return setAuthError('아이디, 비밀번호, 닉네임은 필수입니다.');
    }

    try {
      const res = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authUsername,
          password: authPassword,
          nickname: authNickname,
          refundAccount: authRefundAccount
        })
      });
      const data = await res.json();
      if (res.ok) {
        setJwtToken(data.token);
        setCurrentUser(data.user);
        setNicknameInput(data.user.nickname);
        localStorage.setItem('something_jwt', data.token);
        localStorage.setItem('something_user', JSON.stringify(data.user));
        setAuthUsername('');
        setAuthPassword('');
        setAuthNickname('');
        setAuthRefundAccount('');
        setAuthError('');
        alert('회원가입 및 로그인이 성공적으로 처리되었습니다.');
      } else {
        setAuthError(data.error || '회원가입 실패');
      }
    } catch (err) {

      const localUsers = JSON.parse(localStorage.getItem('something_users') || '[]');
      if (localUsers.some(u => u.id === authUsername)) {
        return setAuthError('이미 사용 중인 아이디입니다.');
      }
      if (localUsers.some(u => u.nickname === authNickname)) {
        return setAuthError('이미 사용 중인 닉네임입니다.');
      }
      const newUser = {
        id: authUsername,
        password: authPassword,
        nickname: authNickname,
        provider: 'local',
        penaltyCount: 0,
        status: 'ACTIVE',
        suspendedUntil: 0,
        refundAccount: authRefundAccount,
        penaltyFlag: 0,
        createdAt: Date.now()
      };
      localStorage.setItem('something_users', JSON.stringify([...localUsers, newUser]));

      const token = `mock-jwt-${authUsername}`;
      setJwtToken(token);
      setCurrentUser(newUser);
      setNicknameInput(newUser.nickname);
      localStorage.setItem('something_jwt', token);
      localStorage.setItem('something_user', JSON.stringify(newUser));

      setAuthUsername('');
      setAuthPassword('');
      setAuthNickname('');
      setAuthRefundAccount('');
      setAuthError('');
      alert('로컬 모드: 회원가입 및 로그인 성공');
    }
  };

  const handleLogIn = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authUsername || !authPassword) {
      return setAuthError('아이디와 비밀번호를 입력해주세요.');
    }

    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authUsername,
          password: authPassword
        })
      });
      const data = await res.json();
      if (res.ok) {
        setJwtToken(data.token);
        setCurrentUser(data.user);
        setNicknameInput(data.user.nickname);
        localStorage.setItem('something_jwt', data.token);
        localStorage.setItem('something_user', JSON.stringify(data.user));
        setAuthUsername('');
        setAuthPassword('');
        setAuthError('');
        alert('로그인에 성공했습니다.');
      } else {
        setAuthError(data.error || '로그인 실패');
      }
    } catch (err) {

      const localUsers = JSON.parse(localStorage.getItem('something_users') || '[]');
      const seededUsers = [
        { id: "kakao_1", password: "1234", nickname: "침성관배고파", provider: "kakao", penaltyCount: 0, status: "ACTIVE", refundAccount: "하나은행 123-456-789012" },
        { id: "naver_1", password: "1234", nickname: "정문치킨요정", provider: "naver", penaltyCount: 0, status: "ACTIVE", refundAccount: "신한은행 110-222-333333" },
        { id: "google_1", password: "1234", nickname: "쪽문배달왕", provider: "google", penaltyCount: 0, status: "ACTIVE", refundAccount: "우체국 2004-5555-6666" },
        { id: "kakao_2", password: "1234", nickname: "복현관지름신", provider: "kakao", penaltyCount: 1, status: "ACTIVE", refundAccount: "농협 302-1234-5678-99" },
        { id: "naver_2", password: "1234", nickname: "향토관야식러", provider: "naver", penaltyCount: 0, status: "ACTIVE", refundAccount: "카카오뱅크 3333-22-111111" }
      ];

      const allUsers = [...seededUsers, ...localUsers];
      const match = allUsers.find(u => u.id === authUsername && u.password === authPassword);
      if (match) {
        const token = `mock-jwt-${match.id}`;
        setJwtToken(token);
        setCurrentUser(match);
        setNicknameInput(match.nickname);
        localStorage.setItem('something_jwt', token);
        localStorage.setItem('something_user', JSON.stringify(match));
        setAuthUsername('');
        setAuthPassword('');
        setAuthError('');
        alert('로컬 모드: 로그인 성공');
      } else {
        setAuthError('아이디 또는 비밀번호가 틀렸습니다.');
      }
    }
  };

  const handleLogOut = () => {
    setJwtToken('');
    setCurrentUser(null);
    localStorage.removeItem('something_jwt');
    localStorage.removeItem('something_user');
    setActiveTab('board');
    alert('로그아웃 되었습니다.');
  };



  const handleMarkNotificationRead = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (res.ok) {
        fetchNotifications();
      }
    } catch (err) {
      const allNotifs = JSON.parse(localStorage.getItem('something_notifs') || '[]');
      const idx = allNotifs.findIndex(n => n.id === id);
      if (idx !== -1) {
        allNotifs[idx].read = 1;
        localStorage.setItem('something_notifs', JSON.stringify(allNotifs));
        fetchNotifications();
      }
    }
  };





  const handleUpdateNickname = async () => {
    if (!nicknameInput.trim()) return alert("닉네임을 입력해주세요!");
    try {
      const res = await fetch(`${API_BASE_URL}/users/nickname`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ nickname: nicknameInput })
      });
      const data = await res.json();
      if (res.ok) {
        const updatedUser = { ...currentUser, nickname: data.nickname };
        setCurrentUser(updatedUser);
        setJwtToken(data.token);
        localStorage.setItem('something_jwt', data.token);
        localStorage.setItem('something_user', JSON.stringify(updatedUser));
        alert("닉네임이 성공적으로 변경되었습니다.");
        fetchPosts();
        if (selectedPostId) fetchPostDetail(selectedPostId);
      } else {
        alert(data.error || "닉네임 변경에 실패했습니다.");
      }
    } catch (err) {
      const updatedUser = { ...currentUser, nickname: nicknameInput };
      setCurrentUser(updatedUser);
      localStorage.setItem('something_user', JSON.stringify(updatedUser));
      alert("로컬 모드: 닉네임이 에뮬레이션 변경되었습니다.");
    }
  };

  // ----------------------------------------------------------------
  // Create Post Handlers (Supports Multi-Selection Checkbox)
  // ----------------------------------------------------------------
  const handleToggleLocationCheckbox = (gate) => {
    const active = [...newPost.locations];
    const idx = active.indexOf(gate);
    if (idx !== -1) {
      active.splice(idx, 1);
    } else {
      active.push(gate);
    }
    setNewPost(prev => ({ ...prev, locations: active }));
  };

  const handleAddField = () => {
    setNewPost(prev => ({
      ...prev,
      items: [...prev.items, { itemName: '', itemPrice: '' }]
    }));
  };

  const handleItemChange = (index, field, val) => {
    const updated = [...newPost.items];
    updated[index][field] = val;
    setNewPost(prev => ({ ...prev, items: updated }));
  };

  const handleCreatePost = async (e) => {
    e.preventDefault();
    if (!newPost.title.trim()) return alert("방 제목을 입력해주세요!");
    if (newPost.locations.length === 0) return alert("최소 1개 이상의 수령 지정장소를 다중선택해 주세요!");
    if (!newPost.bankAccount.trim()) return alert("정산용 호스트의 계좌번호를 입력해주세요!");
    if (!newPost.hostRealName.trim()) return alert("예금주 실명을 작성해 주세요 (성명 마스킹 보안처리에 필요)!");

    const sanitizedItems = newPost.items
      .filter(item => item.itemName.trim() !== '' && item.itemPrice !== '')
      .map(item => ({ itemName: item.itemName, itemPrice: parseInt(item.itemPrice, 10) }));

    if (sanitizedItems.length === 0) {
      return alert("띵장 본인이 공동구매할 상품을 최소 1개 이상 입력해주세요!");
    }

    const payload = {
      title: newPost.title,
      link: newPost.link || "https://default-order.com",
      category: newPost.category,
      locations: newPost.locations,
      targetPrice: parseInt(newPost.targetPrice, 10),
      baseFee: parseInt(newPost.baseFee, 10),
      autoConfirmFeeLimit: parseInt(newPost.autoConfirmFeeLimit, 10),
      bankAccount: newPost.bankAccount,
      hostRealName: newPost.hostRealName,
      items: sanitizedItems
    };

    try {
      const res = await fetch(`${API_BASE_URL}/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        alert(`몇띵?! 방 개설 성공! 상태: ${data.status}`);
        setIsCreateModalOpen(false);
        // Reset Form
        setNewPost({
          title: '', link: '', category: '식품', locations: [], targetPrice: 30000, baseFee: 3000, autoConfirmFeeLimit: 1200, bankAccount: '', hostRealName: '', items: [{ itemName: '', itemPrice: '' }]
        });
        fetchPosts();
      } else {
        alert(data.error);
      }
    } catch (err) {

      const fallbackId = `post_${Date.now()}`;
      const hostTotal = sanitizedItems.reduce((sum, item) => sum + item.itemPrice, 0);
      const isCond1 = hostTotal >= payload.targetPrice;
      const isCond2 = payload.baseFee < payload.autoConfirmFeeLimit;
      const initialStatus = (isCond1 || isCond2) ? "CONFIRMED" : "OPEN";

      const created = {
        id: fallbackId,
        title: payload.title,
        link: payload.link,
        category: payload.category,
        locations: payload.locations,
        targetPrice: payload.targetPrice,
        baseFee: payload.baseFee,
        autoConfirmFeeLimit: payload.autoConfirmFeeLimit,
        bankAccount: payload.bankAccount,
        hostMaskedName: maskName(payload.hostRealName),
        status: initialStatus,
        hostNickname: currentUser.nickname,
        participantCount: 1,
        currentOrderAmount: hostTotal,
        remainingAmount: Math.max(0, payload.targetPrice - hostTotal),
        createdAt: Date.now()
      };

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
      localStorage.setItem('something_posts', JSON.stringify([created, ...localPosts]));

      const initialMembers = [{
        userId: currentUser.id,
        nickname: currentUser.nickname,
        paymentStatus: 'APPROVED',
        items: sanitizedItems.map(i => ({ ...i, quantity: 1 })),
        individualTotal: hostTotal
      }];
      localStorage.setItem(`something_members_${fallbackId}`, JSON.stringify(initialMembers));
      localStorage.setItem(`something_bookings_${fallbackId}`, JSON.stringify([]));

      alert(`로컬 에뮬레이션: 개설 완료! 방 상태: ${initialStatus}`);
      setIsCreateModalOpen(false);
      setNewPost({
        title: '', link: '', category: '식품', locations: [], targetPrice: 30000, baseFee: 3000, autoConfirmFeeLimit: 1200, bankAccount: '', hostRealName: '', items: [{ itemName: '', itemPrice: '' }]
      });
      fetchPosts();
    }
  };

  // Masking algorithms in client too for standalone emulation
  function maskName(name) {
    if (!name) return "";
    const len = name.length;
    if (len <= 2) return name[0] + "*";
    const mid = Math.floor(len / 2);
    return name.substring(0, mid) + "*" + name.substring(mid + 1);
  }

  // ----------------------------------------------------------------
  // Join Handlers
  // ----------------------------------------------------------------
  const handleAddJoinField = () => {
    setJoinItems(prev => [...prev, { itemName: '', itemPrice: '', quantity: 1 }]);
  };

  const handleJoinItemChange = (index, field, val) => {
    const updated = [...joinItems];
    updated[index][field] = val;
    setJoinItems(updated);
  };

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!joinConsent) return alert("배송비 상한 동의 조항을 체크하셔야 신청 가능합니다.");

    const sanitized = joinItems
      .filter(item => item.itemName.trim() !== '' && item.itemPrice !== '')
      .map(item => ({
        itemName: item.itemName,
        itemPrice: parseInt(item.itemPrice, 10),
        quantity: parseInt(item.quantity, 10)
      }));

    if (sanitized.length === 0) return alert("주문할 최소 1개 이상의 상품을 입력하세요.");

    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ items: sanitized, consent: true })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`합류가 정상 처리되었습니다! 상태: ${data.status}`);
        setIsJoinModalOpen(false);
        setJoinItems([{ itemName: '', itemPrice: '', quantity: 1 }]);
        setJoinConsent(false);
        fetchPostDetail(selectedPostId);
        fetchPosts();
      } else {
        alert(data.error);
      }
    } catch (err) {

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
      const postIdx = localPosts.findIndex(p => p.id === selectedPostId);
      if (postIdx === -1) return;

      const post = localPosts[postIdx];
      const localMembers = JSON.parse(localStorage.getItem(`something_members_${selectedPostId}`) || '[]');

      const userTotal = sanitized.reduce((sum, item) => sum + (item.itemPrice * item.quantity), 0);

      const existingIdx = localMembers.findIndex(m => m.userId === currentUser.id);
      if (existingIdx !== -1) {
        localMembers[existingIdx] = {
          userId: currentUser.id,
          nickname: currentUser.nickname,
          paymentStatus: 'PENDING',
          items: sanitized,
          individualTotal: userTotal
        };
      } else {
        localMembers.push({
          userId: currentUser.id,
          nickname: currentUser.nickname,
          paymentStatus: 'PENDING',
          items: sanitized,
          individualTotal: userTotal
        });
      }

      localStorage.setItem(`something_members_${selectedPostId}`, JSON.stringify(localMembers));

      const totalAccumulated = localMembers.reduce((sum, m) => sum + m.individualTotal, 0);
      const participantCount = localMembers.length;
      const isCond1 = totalAccumulated >= post.targetPrice;
      const isCond2 = (post.baseFee / participantCount) < post.autoConfirmFeeLimit;

      let nextStatus = post.status;
      let confirmedAt = post.confirmedAt || 0;
      if (post.status === 'OPEN' && (isCond1 || isCond2)) {
        nextStatus = "CONFIRMED";
        confirmedAt = Date.now();

        // Generate confirmation notification centrally for the joined pool
        const splitFee = isCond1 ? 0 : Math.round(post.baseFee / participantCount);
        const allNotifs = JSON.parse(localStorage.getItem('something_notifs') || '[]');
        localMembers.forEach(m => {
          const personalTotal = m.individualTotal + splitFee;
          allNotifs.unshift({
            id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            userId: m.userId,
            title: `[공구 확정] ${post.title}`,
            content: `공동구매 매칭이 확정되었습니다!\n• 호스트 예금주: ${post.hostRealName || '서은아'}\n• 송금 계좌: ${post.bankAccount}\n• 나의 입금액: ${personalTotal.toLocaleString()}원 (상품금액 ${m.individualTotal.toLocaleString()}원 + 1/N 배송비 ${splitFee.toLocaleString()}원)`,
            type: 'CONFIRMED',
            read: 0,
            createdAt: Date.now()
          });
        });
        localStorage.setItem('something_notifs', JSON.stringify(allNotifs));
      }

      localPosts[postIdx] = {
        ...post,
        status: nextStatus,
        participantCount,
        currentOrderAmount: totalAccumulated,
        remainingAmount: Math.max(0, post.targetPrice - totalAccumulated),
        confirmedAt
      };

      localStorage.setItem('something_posts', JSON.stringify(localPosts));

      alert(`로컬 에뮬레이션: 합류 완료! 방 상태: ${nextStatus}`);
      setIsJoinModalOpen(false);
      setJoinItems([{ itemName: '', itemPrice: '', quantity: 1 }]);
      setJoinConsent(false);
      fetchPostDetail(selectedPostId);
      fetchPosts();
    }
  };

  // ----------------------------------------------------------------
  // Payment Flow: Mark Sent & Deposit Manual Approval
  // ----------------------------------------------------------------
  const handleMarkPaymentSent = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/payment/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ simulateLate: false })
      });
      if (res.ok) {
        alert("송금 완료 신고가 처리되었습니다. 호스트의 승인을 대기합니다.");
        fetchPostDetail(selectedPostId);
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      const localMembers = JSON.parse(localStorage.getItem(`something_members_${selectedPostId}`) || '[]');
      const idx = localMembers.findIndex(m => m.userId === currentUser.id);
      if (idx !== -1) {
        localMembers[idx].paymentStatus = 'SENT';
        localMembers[idx].sentAt = Date.now();
        localStorage.setItem(`something_members_${selectedPostId}`, JSON.stringify(localMembers));
        alert("로컬 에뮬레이션: 송금 완료 신고가 승인되었습니다.");
        fetchPostDetail(selectedPostId);
      }
    }
  };

  const handleApproveDeposit = async (memberUserId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/payment/approve/${memberUserId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (data.penaltyApplied) {
          setPenaltyAlert({
            targetUserId: memberUserId,
            offenseLevel: data.penaltyDetails.offenseLevel,
            nextStatus: data.penaltyDetails.nextStatus
          });
        } else {
          alert("입금 승인이 완료되었습니다.");
        }
        fetchPostDetail(selectedPostId);
        refreshUserProfile();
      } else {
        alert(data.error);
      }
    } catch (err) {

      const localMembers = JSON.parse(localStorage.getItem(`something_members_${selectedPostId}`) || '[]');
      const idx = localMembers.findIndex(m => m.userId === memberUserId);
      if (idx !== -1) {
        localMembers[idx].paymentStatus = 'APPROVED';
        localMembers[idx].approvedAt = Date.now();

        // Local simulate penalty check
        const sentAt = localMembers[idx].sentAt || Date.now();
        const post = JSON.parse(localStorage.getItem('something_posts')).find(p => p.id === selectedPostId);
        const confirmedAt = post ? post.confirmedAt || (Date.now() - 3600000) : Date.now();

        let penaltyStr = "";
        if (sentAt - confirmedAt > 24 * 60 * 60 * 1000) {
          penaltyStr = "⚠️ 벌점 연체 1차 경고! 사용자가 정산 연체 벌점 3일 정지를 받았습니다.";
        }

        localStorage.setItem(`something_members_${selectedPostId}`, JSON.stringify(localMembers));
        alert("로컬 에뮬레이션: 입금 최종 승인 완료! " + penaltyStr);
        fetchPostDetail(selectedPostId);
      }
    }
  };

  const handleRescueGroupBuy = async (strategy) => {
    setRescueLoading(true);
    // Find all users who are not host and paymentStatus is PENDING
    const unpaidUserIds = postMembers
      .filter(m => m.userId !== postDetail?.hostId && m.paymentStatus === 'PENDING')
      .map(m => m.userId);

    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/rescue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          ejectedUserIds: unpaidUserIds,
          actionStrategy: strategy
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (strategy === 'RE_OPEN') {
          alert("미입금자 방출 후 공구 재오픈 완료!");
        } else {
          alert("미입금자 방출 후 남은 띵원들에게 추가 배송비 입금 알림 발송 완료!");
        }
        setIsRescueModalOpen(false);
        fetchPostDetail(selectedPostId);
        fetchPosts();
      } else {
        alert(data.error || "구출 작업에 실패했습니다.");
      }
    } catch (err) {

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
      const postIdx = localPosts.findIndex(p => p.id === selectedPostId);
      if (postIdx === -1) return;

      const post = localPosts[postIdx];
      const localMembers = JSON.parse(localStorage.getItem(`something_members_${selectedPostId}`) || '[]');

      const previousCount = localMembers.length;
      const previousTotalAmount = localMembers.reduce((sum, m) => sum + m.individualTotal, 0);
      const previousFreeShippingMet = previousTotalAmount >= post.targetPrice;
      const previousSplitFee = previousFreeShippingMet ? 0 : Math.round((post.baseFee || 3000) / (previousCount || 1));

      const pendingMembers = localMembers.filter(m => m.userId !== post.hostId && m.paymentStatus === 'PENDING');
      const updatedMembers = localMembers.filter(m => m.userId === post.hostId || m.paymentStatus !== 'PENDING');
      localStorage.setItem(`something_members_${selectedPostId}`, JSON.stringify(updatedMembers));

      // Remove slot bookings for ejected users
      const bookings = JSON.parse(localStorage.getItem(`something_bookings_${selectedPostId}`) || '[]');
      const paidUserIds = updatedMembers.map(m => m.userId);
      const updatedBookings = bookings.filter(b => paidUserIds.includes(b.userId));
      localStorage.setItem(`something_bookings_${selectedPostId}`, JSON.stringify(updatedBookings));

      // Calculate totals
      const totalAccumulated = updatedMembers.reduce((sum, m) => sum + m.individualTotal, 0);
      const participantCount = updatedMembers.length;

      let nextStatus = post.status;
      if (strategy === 'RE_OPEN') {
        nextStatus = 'OPEN';
        post.confirmedAt = 0;
      }

      localPosts[postIdx] = {
        ...post,
        status: nextStatus,
        participantCount,
        currentOrderAmount: totalAccumulated,
        remainingAmount: Math.max(0, post.targetPrice - totalAccumulated)
      };
      localStorage.setItem('something_posts', JSON.stringify(localPosts));

      // Apply penalty locally for ejected members
      let localUsers = JSON.parse(localStorage.getItem('something_users') || '[]');
      const allNotifs = JSON.parse(localStorage.getItem('something_notifs') || '[]');

      for (const pm of pendingMembers) {
        const uIdx = localUsers.findIndex(u => u.id === pm.userId);
        let newCount = 1;
        let newStatus = 'SUSPENDED_3D';
        if (uIdx !== -1) {
          newCount = (localUsers[uIdx].penaltyCount || 0) + 1;
          if (newCount === 1) newStatus = 'SUSPENDED_3D';
          else if (newCount === 2) newStatus = 'SUSPENDED_30D';
          else newStatus = 'BANNED';

          localUsers[uIdx].penaltyCount = newCount;
          localUsers[uIdx].status = newStatus;
          localUsers[uIdx].penaltyFlag = 1;

          if (pm.userId === currentUser?.id) {
            setCurrentUser(prev => ({ ...prev, penaltyCount: newCount, status: newStatus }));
          }
        }

        // 1. Eviction notification to evicted user
        allNotifs.unshift({
          id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          userId: pm.userId,
          title: `[공구 방출] 미입금 연체 방출 및 패널티 부과 안내`,
          content: `귀하가 참여 중인 공동구매 '${post.title}'에서 24시간 정산 기한 내에 입금이 확인되지 않아 자동 방출 처리되었습니다.\n• 적용 패널티: 벌점 1회 누적\n• 제재 등급: ${newStatus === 'SUSPENDED_3D' ? '🚫 3일 이용정지' : newStatus === 'SUSPENDED_30D' ? '🚫 30일 이용정지' : '🛑 영구 정지 (BAN)'}\n• 입금 내역이 확인되지 않아 환불 대상에는 포함되지 않습니다.`,
          type: 'CANCELLATION',
          read: 0,
          createdAt: Date.now()
        });
      }

      localStorage.setItem('something_users', JSON.stringify(localUsers));
      // 3. Notification to remaining members
      const remainingPaid = updatedMembers.filter(m => m.userId !== post.hostId);
      if (strategy === 'RE_OPEN') {
        for (const rm of remainingPaid) {
          allNotifs.unshift({
            id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            userId: rm.userId,
            title: `[공구 재오픈] 공구 방 재모집 안내`,
            content: `미입금 인원 방출로 인해 공동구매 '${post.title}'가 다시 모집 중(OPEN) 상태로 복구되었습니다. 신규 띵원이 충원되어 무료배송 조건이 충족되거나 배송비 자동승인 한도가 충족되면 재확정됩니다.`,
            type: 'CANCELLATION',
            read: 0,
            createdAt: Date.now()
          });
        }
      } else if (strategy === 'SPLIT_REMAINING') {
        const freeShippingStillMet = totalAccumulated >= post.targetPrice;
        const newSplitFee = freeShippingStillMet ? 0 : Math.round((post.baseFee || 3000) / updatedMembers.length);
        const additionalShippingFee = Math.max(0, newSplitFee - previousSplitFee);
        for (const rm of remainingPaid) {
          allNotifs.unshift({
            id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            userId: rm.userId,
            title: `미입금자 발생으로 인한 배송비 조정 발생 !`,
            content: `미입금 인원 방출로 공동구매 배송비가 1/N 재조정되었습니다.\n• 추가 송금해야 할 배송비: ${additionalShippingFee.toLocaleString()}원 (기존 배송비 ${previousSplitFee.toLocaleString()}원 → 변경 배송비 ${newSplitFee.toLocaleString()}원)\n• 띵장 송금 계좌: ${post.bankAccount}\n\n차액 ${additionalShippingFee.toLocaleString()}원을 위 계좌로 즉시 송금해 주시기 바랍니다.`,
            type: 'CANCELLATION',
            read: 0,
            createdAt: Date.now()
          });
        }
      }

      localStorage.setItem('something_notifs', JSON.stringify(allNotifs));

      if (strategy === 'RE_OPEN') {
        alert("미입금자 방출 후 공구 재오픈 완료!");
      } else {
        alert("미입금자 방출 후 남은 띵원들에게 추가 배송비 입금 알림 발송 완료!");
      }

      setIsRescueModalOpen(false);
      fetchPostDetail(selectedPostId);
      fetchPosts();
      fetchNotifications();
    } finally {
      setRescueLoading(false);
    }
  };

  // ----------------------------------------------------------------
  // Timetable and Arrival notifications Handlers
  // ----------------------------------------------------------------
  const handleMarkArrival = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/arrive`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      if (res.ok) {
        alert("물품 도착 알림이 전체 띵원들에게 전송되었습니다! 수령 스케줄을 확보하세요.");
        fetchPostDetail(selectedPostId);
        fetchPosts();
      }
    } catch (err) {

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
      const postIdx = localPosts.findIndex(p => p.id === selectedPostId);
      if (postIdx !== -1) {
        localPosts[postIdx].status = 'ARRIVED';
        localStorage.setItem('something_posts', JSON.stringify(localPosts));

        // Generate arrival notifications centrally
        const members = JSON.parse(localStorage.getItem(`something_members_${selectedPostId}`) || '[]');
        const allNotifs = JSON.parse(localStorage.getItem('something_notifs') || '[]');
        members.forEach(m => {
          if (m.userId === currentUser.id) return;
          allNotifs.unshift({
            id: `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            userId: m.userId,
            title: `[물품 도착 알림] ${localPosts[postIdx].title}`,
            content: `띵장이 수령한 공구 물품이 약속 장소에 도착했습니다!\n위클리 시간표 수령 예약을 선착순으로 작성하셔서 차질없이 물품을 찾아가시기 바랍니다.`,
            type: 'ARRIVAL',
            read: 0,
            createdAt: Date.now()
          });
        });
        localStorage.setItem('something_notifs', JSON.stringify(allNotifs));

        alert("로컬 에뮬레이션: 물품 수령/도착 알림 전송 완료!");
        fetchPostDetail(selectedPostId);
        fetchPosts();
      }
    }
  };

  const handleToggleTimetableSlot = (day, time) => {
    // Only host can modify their slots list
    if (postDetail.hostId !== currentUser?.id) return;

    const key = `${day}-${time}`;
    const active = [...tempTimetableSlots];
    const idx = active.indexOf(key);
    if (idx !== -1) {
      active.splice(idx, 1);
    } else {
      active.push(key);
    }
    setTempTimetableSlots(active);
  };

  const handleSaveTimetable = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/timetable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ slots: tempTimetableSlots })
      });
      if (res.ok) {
        alert("수령 가능 시간표 슬롯이 성공적으로 갱신되었습니다!");
        fetchPostDetail(selectedPostId);
      }
    } catch (err) {

      const localPosts = JSON.parse(localStorage.getItem('something_posts') || '[]');
      const postIdx = localPosts.findIndex(p => p.id === selectedPostId);
      if (postIdx !== -1) {
        localPosts[postIdx].timetableSlots = tempTimetableSlots;
        localStorage.setItem('something_posts', JSON.stringify(localPosts));
        alert("로컬 에뮬레이션: 시간표 사용 가능 슬롯이 갱신되었습니다.");
        fetchPostDetail(selectedPostId);
      }
    }
  };

  const handleBookPickupSlot = async (slotKey) => {
    // Participant booking action trigger
    setSelectedPickupSlotKey(slotKey);
    // Auto-select first designated location
    setSelectedPickupGate(postDetail.locations[0] || '정문');
  };

  const handleConfirmPickupBooking = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/posts/${selectedPostId}/pickup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({
          slotKey: selectedPickupSlotKey,
          location: selectedPickupGate
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert("수령 일정이 정상 예약되었습니다!");
        setSelectedPickupSlotKey(null);
        fetchPostDetail(selectedPostId);
      } else {
        alert(data.error);
      }
    } catch (err) {

      const bookings = JSON.parse(localStorage.getItem(`something_bookings_${selectedPostId}`) || '[]');

      // Conflict gate validation
      const taken = bookings.find(b => b.slotKey === selectedPickupSlotKey);
      if (taken && taken.location !== selectedPickupGate) {
        return alert(`🚫 로컬 에뮬레이션 예약 충돌: 해당 시간대는 이미 '${taken.nickname}' 띵원이 '${taken.location}'에서 수령하기로 선점했습니다. 동일한 '${taken.location}'에서 수령을 동의하시거나, 다른 가능 시간대를 찾아보세요!`);
      }

      // Overwrite/insert (enforce exactly ONE slot booking per participant)
      const updatedBookings = bookings.filter(b => b.userId !== currentUser.id);
      updatedBookings.push({
        id: `slot_${Date.now()}`,
        slotKey: selectedPickupSlotKey,
        location: selectedPickupGate,
        nickname: currentUser.nickname,
        userId: currentUser.id
      });

      localStorage.setItem(`something_bookings_${selectedPostId}`, JSON.stringify(updatedBookings));
      alert("로컬 에뮬레이션: 수령 예약 완료!");
      setSelectedPickupSlotKey(null);
      fetchPostDetail(selectedPostId);
    }
  };

  // Helper dynamic totals for join form
  const getJoinFormTotal = () => {
    return joinItems.reduce((sum, item) => {
      const price = parseInt(item.itemPrice, 10) || 0;
      const qty = parseInt(item.quantity, 10) || 1;
      return sum + (price * qty);
    }, 0);
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-tr from-white via-primary-50 to-primary-100 flex flex-col justify-center items-center py-12 px-4 sm:px-6 lg:px-8 font-sans text-primary-900 animate-in fade-in duration-300">

        {/* Banner header inside login page */}
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center space-y-3 mb-6">
          <div className="h-16 w-16 bg-primary-500 rounded-3xl flex items-center justify-center text-primary-900 shadow-xl shadow-primary-500/20 mx-auto border border-primary-400">
            <ShoppingBag size={32} className="stroke-[2.5]" />
          </div>
          <div>
            {/* 텍스트 색상을 white에서 브라운(primary-900)으로 변경 */}
            <h2 className="text-3xl font-black tracking-tight text-primary-900 font-sans">
              N Thing?! <span className="text-primary-500 font-black text-4xl font-serif">몇 띵?!</span>
            </h2>
            <p className="text-xs font-bold text-primary-700 tracking-widest uppercase mt-1">배송비 아까워서 장바구니만 넣었다 뺐다 하고 있을 때</p>
          </div>
          <p className="text-sm font-medium text-primary-800">스마트 공동구매 플랫폼</p>
        </div>

        <div className="bg-white/70 backdrop-blur-md border border-primary-200 rounded-3xl p-8 max-w-md w-full shadow-xl shadow-primary-200/50 space-y-6">

          {/* Tabs for Login / SignUp */}
          <div className="flex bg-primary-100 rounded-2xl p-1 border border-primary-200">
            <button
              onClick={() => { setAuthMode('login'); setAuthError(''); }}
              className={`w-1/2 py-3 rounded-xl text-xs font-extrabold transition-all ${
                // 활성화 시 폼폼푸린 옐로우, 비활성화 시 브라운 텍스트
                authMode === 'login' ? 'bg-primary-500 text-primary-900 shadow-md shadow-primary-500/20' : 'text-primary-700 hover:text-primary-900'
                }`}
            >
              🔑 로그인
            </button>
            <button
              onClick={() => { setAuthMode('signup'); setAuthError(''); }}
              className={`w-1/2 py-3 rounded-xl text-xs font-extrabold transition-all ${authMode === 'signup' ? 'bg-primary-500 text-primary-900 shadow-md shadow-primary-500/20' : 'text-primary-700 hover:text-primary-900'
                }`}
            >
              🙋‍♀️ 회원가입
            </button>
          </div>


          {authError && (
            <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-3.5 flex gap-2.5 text-xs text-red-400 font-bold items-start leading-relaxed">
              <AlertTriangle className="shrink-0 mt-0.5" size={16} />
              <span>{authError}</span>
            </div>
          )}

          <form onSubmit={authMode === 'login' ? handleLogIn : handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-extrabold text-slate-400 mb-1.5">학번 또는 포털 ID *</label>
              <input
                type="text"
                required
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-primary-500/30 focus:outline-none text-white placeholder-slate-500 font-bold"
                placeholder="아이디를 입력하세요 (예: user1)"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-400 mb-1.5">비밀번호 *</label>
              <input
                type="password"
                required
                className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-primary-500/30 focus:outline-none text-white placeholder-slate-500 font-bold"
                placeholder="비밀번호를 입력하세요"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
            </div>

            {authMode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-extrabold text-slate-400 mb-1.5">캠퍼스 닉네임 *</label>
                  <input
                    type="text"
                    required
                    className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-primary-500/30 focus:outline-none text-white placeholder-slate-500 font-bold"
                    placeholder="예: 첨성관야식대장"
                    value={authNickname}
                    onChange={(e) => setAuthNickname(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-400 mb-1.5">정산/환불용 은행 및 계좌번호</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-primary-500/30 focus:outline-none text-white placeholder-slate-500 font-bold"
                    placeholder="예: 신한은행 110-123-456789"
                    value={authRefundAccount}
                    onChange={(e) => setAuthRefundAccount(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-500 mt-1 font-medium">⚠️ 공구 자동 방출/일부 무산 시 환불금을 돌려받으실 수 있는 계좌 정보입니다.</p>
                </div>
              </>
            )}

            <button
              type="submit"
              className="w-full bg-primary-500 hover:bg-primary-600 active:scale-[0.98] text-white font-extrabold text-xs py-3.5 rounded-xl shadow-lg shadow-primary-500/20 transition-all cursor-pointer"
            >
              {authMode === 'login' ? '로그인 완료하기' : '몇띵 가입 및 로그인하기'}
            </button>
          </form>


        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary-50 text-primary-900 pb-20">

      {/* ---------------------------------------------------- */}
      {/* Banner & Logged-In User Header */}
      {/* ---------------------------------------------------- */}
      <div className="bg-gradient-to-r from-primary-400 to-primary-500 py-3 px-4 shadow-md text-primary-900 text-xs sm:text-sm font-medium flex flex-wrap gap-4 items-center justify-between border-b border-primary-300">
        <div className="flex items-center gap-2">
          <span className="bg-white text-primary-700 font-extrabold px-2 py-0.5 rounded text-[10px] uppercase shadow-sm">AUTHENTICATED</span>
          <span className="font-bold">🛒 N Thing?! (몇 띵?!) - 공동 구매 플랫폼</span>
        </div>

        {/* User Account Info & LogOut */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white/40 py-1 px-3 rounded-full border border-white/50">
            <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping mr-1" />
            <span className="text-[10px] text-primary-900 font-extrabold">
              {currentUser.nickname} ({currentUser.provider === 'local' ? '회원' : currentUser.provider.toUpperCase()})
            </span>
          </div>
          <button
            onClick={handleLogOut}
            className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-3 py-1 rounded-full transition-all border border-primary-700/50 text-[10px] cursor-pointer"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* Main Brand Navbar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-stone-200 py-4 px-6 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-primary-500 rounded-2xl flex items-center justify-center text-white shadow-md shadow-primary-500/20">
            <ShoppingBag size={20} className="stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-neutral-900 font-sans flex items-center gap-1">
              N Thing?! <span className="text-primary-500 font-black text-2xl font-serif">몇 띵?!</span>
            </h1>
            <p className="text-[9px] font-bold text-slate-400 -mt-1 tracking-widest uppercase">배송비 아까워서 장바구니만 넣었다 뺐다 하고 있을 때</p>
          </div>
        </div>

        {/* Tab & Actions Controls */}
        <div className="flex items-center gap-3">
          <nav className="flex bg-stone-100 rounded-xl p-1 border border-stone-200 text-xs font-bold">
            <button
              onClick={() => setActiveTab('board')}
              className={`px-4 py-2 rounded-lg transition-all ${activeTab === 'board' ? 'bg-white text-primary-500 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              📋 지금 몇띵?!
            </button>
            <button
              onClick={() => {
                setActiveTab('notifications');
                fetchNotifications();
              }}
              className={`px-4 py-2 rounded-lg transition-all relative ${activeTab === 'notifications' ? 'bg-white text-primary-500 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              🔔 알림함
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full h-4 w-4 text-[9px] flex items-center justify-center font-extrabold animate-pulse">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setActiveTab('mypage');
                refreshUserProfile();
                fetchMyPagePosts();
              }}
              className={`px-4 py-2 rounded-lg transition-all ${activeTab === 'mypage' ? 'bg-white text-primary-500 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              👤 마이페이지
            </button>
          </nav>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 bg-neutral-900 text-white hover:bg-neutral-800 font-bold px-4 py-2 rounded-xl text-xs sm:text-sm transition-all shadow-md active:scale-[0.98]"
          >
            <Plus size={15} />
            <span>새로운 띵 개설</span>
          </button>
        </div>
      </header>

      {/* Penalty alert overlay banner if penalty triggered */}
      {penaltyAlert && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center border-2 border-red-500 shadow-2xl animate-bounce">
            <AlertOctagon size={44} className="text-red-500 mx-auto animate-pulse" />
            <h3 className="text-lg font-black text-slate-900 mt-3">🚨 정산 기한 초과 패널티 부과</h3>
            <p className="text-xs text-red-600 font-bold mt-1">미입금 연체 기록이 확인되었습니다!</p>

            <div className="mt-4 bg-red-50 rounded-2xl p-4 text-xs text-slate-700 border border-red-200">
              <p>대상 사용자 ID: <span className="font-bold">{penaltyAlert.targetUserId}</span></p>
              <p className="mt-1">누적 패널티 위반 횟수: <span className="text-red-600 font-black text-sm">{penaltyAlert.offenseLevel}회</span></p>
              <p className="mt-1 font-bold text-red-700 bg-red-100/80 px-2.5 py-1 rounded inline-block mt-2">
                제재 상태: {penaltyAlert.nextStatus === 'SUSPENDED_3D' ? '🚫 3일 이용정지' : penaltyAlert.nextStatus === 'SUSPENDED_30D' ? '🚫 30일 이용정지' : '🛑 영구 정지 (BAN)'}
              </p>
            </div>

            <button
              onClick={() => setPenaltyAlert(null)}
              className="mt-5 w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl transition-all"
            >
              위반 제재 내역 확인 완료
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 1. VIEW TAB: Board View */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'board' && (
        <div className="animate-in fade-in duration-200">
          <section className="max-w-7xl mx-auto px-4 mt-8">

            {backendError && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 mb-6 flex items-start gap-2.5 text-xs shadow-sm">
                <AlertTriangle className="text-amber-500 shrink-0 mt-0.5 animate-pulse" size={16} />
                <div>
                  <span className="font-bold">로컬 데모 에뮬레이션 활성화:</span> {backendError}
                  <button
                    onClick={fetchPosts}
                    className="ml-2 font-bold underline hover:text-amber-950 flex inline-flex items-center gap-0.5"
                  >
                    <RefreshCw size={10} className="animate-spin" /> 서버 다시 연결하기
                  </button>
                </div>
              </div>
            )}

            {/* Filter Bar with multi-location overlap select */}
            <div className="bg-white rounded-2xl p-6 border border-stone-200/80 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">

              <div className="w-full md:w-1/3 relative">
                {isLocationDropdownOpen && (
                  <div className="fixed inset-0 z-10" onClick={() => setIsLocationDropdownOpen(false)} />
                )}

                <div
                  onClick={() => setIsLocationDropdownOpen(prev => !prev)}
                  className="relative z-20 flex items-center justify-between gap-2 bg-stone-100/80 rounded-xl px-3.5 py-2.5 border border-stone-200 shadow-inner cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2 overflow-hidden w-full">
                    <MapPin size={18} className="text-primary-500 shrink-0" />
                    <span className="text-slate-800 text-sm font-bold truncate">
                      {selectedLocations.length === 0
                        ? "🏫 전체 수령 지정장소 필터링"
                        : selectedLocations.length === 1
                          ? `📍 ${selectedLocations[0]}`
                          : `📍 ${selectedLocations[0]} 외 ${selectedLocations.length - 1}곳`
                      }
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-bold shrink-0">
                    {isLocationDropdownOpen ? '▲' : '▼'}
                  </span>
                </div>

                {isLocationDropdownOpen && (
                  <div className="absolute left-0 right-0 mt-2 bg-white border border-stone-200 rounded-2xl shadow-xl z-30 p-4 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="flex justify-between items-center pb-2 mb-2 border-b border-stone-100">
                      <span className="text-xs font-black text-slate-500">📍 수령 희망 장소 (다중선택)</span>
                      {selectedLocations.length > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLocations([]);
                          }}
                          className="text-[10px] font-bold text-red-500 hover:underline"
                        >
                          모두 해제
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {STANDARD_LOCATIONS.map(loc => {
                        const isChecked = selectedLocations.includes(loc);
                        return (
                          <label
                            key={loc}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-[11px] font-bold cursor-pointer select-none transition-all ${isChecked
                              ? 'bg-primary-50 border-primary-200 text-primary-600'
                              : 'bg-stone-50 border-stone-200 text-slate-600 hover:border-stone-300'
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedLocations(prev =>
                                  prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]
                                );
                              }}
                              className="h-3 w-3 text-primary-500 rounded focus:ring-0 cursor-pointer"
                            />
                            <span className="truncate">{loc}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Real-time search query bar */}
              <div className="w-full md:w-2/3 flex items-center gap-2 bg-stone-100/80 rounded-xl px-3.5 py-2.5 border border-stone-200 shadow-inner">
                <Search size={18} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  className="bg-transparent border-none focus:outline-none w-full text-sm placeholder-slate-400"
                  placeholder="노트, 무선제본, 수영장문, 문구류 등 드시고 싶거나 필요한 상품명을 검색해 보세요!"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Category pills header selector */}
            <div className="flex gap-2 overflow-x-auto py-4 -mx-4 px-4 no-scrollbar">
              <button
                onClick={() => setSelectedCategory('')}
                className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all whitespace-nowrap border ${selectedCategory === ''
                  ? 'bg-primary-500 border-primary-600 text-white shadow-md shadow-primary-500/20'
                  : 'bg-white border-stone-200 text-slate-600 hover:border-slate-300'
                  }`}
              >
                📦 지금 몇띵?!
              </button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-5 py-2.5 rounded-full text-xs font-bold transition-all whitespace-nowrap border flex items-center gap-1.5 ${selectedCategory === cat.id
                    ? 'bg-primary-500 border-primary-600 text-white shadow-md shadow-primary-500/20'
                    : 'bg-white border-stone-200 text-slate-600 hover:border-slate-300'
                    }`}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.id}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Core Grid Board List View */}
          <main className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 lg:grid-cols-3 gap-8">

            <section className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-black text-slate-900 font-sans flex items-center gap-2">
                  🔥 진행 중인 띵 (공동구매) 리스트
                  <span className="bg-primary-50 text-primary-500 text-xs font-extrabold px-2 py-0.5 rounded-full border border-primary-200">
                    {posts.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase())).length}개
                  </span>
                </h2>
                <p className="text-xs text-slate-400">다중선택 위치기반 매칭 실시간 필터링 적용</p>
              </div>

              {loading ? (
                <div className="bg-white rounded-2xl p-16 border border-stone-200 flex flex-col items-center justify-center">
                  <RefreshCw size={28} className="animate-spin text-primary-500" />
                  <p className="text-sm font-semibold text-slate-400 mt-4 font-sans">띵 목록을 탐색하고 있습니다...</p>
                </div>
              ) : posts.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                <div className="bg-white rounded-2xl p-16 border border-stone-200 flex flex-col items-center justify-center text-center">
                  <div className="h-16 w-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-400 mb-4 text-3xl">🏜️</div>
                  <h3 className="font-bold text-slate-800 text-base">선택된 카테고리/위치의 띵이 없습니다.</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">원하는 상품 분담 모집글이 없다면 직접 다중 수령장소를 선점하여 띵을 최초로 개설해 보세요!</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {posts
                    .filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(post => {
                      const shopDomain = post.link ? new URL(post.link).hostname : 'coupang.com';
                      const percent = Math.min(100, Math.round((post.currentOrderAmount / post.targetPrice) * 100));

                      return (
                        <div
                          key={post.id}
                          onClick={() => setSelectedPostId(post.id)}
                          className={`group cursor-pointer rounded-2xl bg-white p-5 border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${selectedPostId === post.id ? 'border-primary-500 ring-2 ring-primary-500/10' : 'border-stone-200/90'
                            }`}
                        >
                          <div className="flex justify-between items-center gap-2 mb-3">
                            <span className="text-[10px] font-bold text-slate-400 bg-stone-100 px-2 py-0.5 rounded border border-stone-200 max-w-[120px] truncate">
                              🌐 {shopDomain}
                            </span>

                            <div className="flex gap-1.5">
                              {post.status === 'COMPLETED' ? (
                                <span className="bg-stone-100 text-stone-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-stone-200">
                                  ✅ 띵 종료
                                </span>
                              ) : post.status === 'ARRIVED' ? (
                                <span className="bg-purple-50 text-purple-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-purple-200 flex items-center gap-0.5 animate-pulse-slow">
                                  <Bell size={10} /> 물품 도착!
                                </span>
                              ) : post.status === 'CONFIRMED' ? (
                                <span className="bg-emerald-50 text-emerald-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-0.5">
                                  <CheckCircle size={10} /> 띵 확정!
                                </span>
                              ) : (
                                <span className="bg-orange-50 text-orange-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-orange-200">
                                  ⌛ 모집 중
                                </span>
                              )}
                            </div>
                          </div>

                          <h3 className="font-extrabold text-neutral-800 text-sm group-hover:text-primary-500 transition-colors line-clamp-2">
                            {post.title}
                          </h3>

                          {/* Progress bar */}
                          <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-[11px] text-slate-400 font-semibold">
                              <span>📊 목표달성률: {percent}%</span>
                              <span className="text-slate-800 font-bold">{post.currentOrderAmount.toLocaleString()}원 / {post.targetPrice.toLocaleString()}원</span>
                            </div>
                            <div className="w-full bg-stone-100 rounded-full h-2 overflow-hidden shadow-inner border border-stone-200/50">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${post.status === 'OPEN' ? 'bg-primary-500' : post.status === 'ARRIVED' ? 'bg-purple-500' : 'bg-emerald-500'
                                  }`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>

                          {/* Location multi badges list */}
                          <div className="mt-4 pt-3.5 border-t border-stone-100 flex items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap gap-1 max-w-[65%]">
                              {post.locations.map((loc, i) => (
                                <span key={i} className="text-[10px] font-bold text-slate-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded">
                                  📍 {loc}
                                </span>
                              ))}
                            </div>

                            <span className="flex items-center gap-1 font-bold text-primary-500 bg-primary-50 px-2 py-1 rounded-lg border border-primary-100 text-[10px] sm:text-xs">
                              <Users size={12} />
                              <span>{post.participantCount}명이 띵중</span>
                            </span>
                          </div>

                          <div className="mt-2.5 text-[11px] font-extrabold bg-stone-50 border border-stone-200/60 p-2 rounded-xl flex items-center gap-1.5 text-slate-500">
                            <Info size={12} className="text-primary-400" />
                            <span>
                              {post.remainingAmount > 0
                                ? `${post.remainingAmount.toLocaleString()}원 추가 모집 시 배송 무료!`
                                : '🎉 무료배송 한도 달성완료!'}
                            </span>
                          </div>

                        </div>
                      );
                    })}
                </div>
              )}
            </section>

            {/* Dynamic Detail inspector panel */}
            <section className="lg:col-span-1 space-y-4">
              <h2 className="text-lg font-black text-slate-900 font-sans">🔎 선택된 몇띵?! 상세</h2>

              {!selectedPostId ? (
                <div className="bg-white rounded-2xl p-10 border border-stone-200 text-center flex flex-col items-center justify-center text-slate-400 shadow-sm">
                  <Eye size={28} className="text-slate-300 stroke-[1.5]" />
                  <p className="text-xs font-bold mt-3">확인할 띵 카드를 탭하십시오</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">실시간 정산 상태, 24시간 연체 제재, 띵장의 위클리 수령 시간표가 노출됩니다!</p>
                </div>
              ) : !postDetail ? (
                <div className="bg-white rounded-2xl p-10 border border-stone-200 flex justify-center py-16">
                  <RefreshCw size={24} className="animate-spin text-primary-500" />
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-stone-200 shadow-md p-5 space-y-5">

                  <div>
                    <span className="text-[10px] font-extrabold bg-primary-50 text-primary-600 px-2 py-0.5 rounded border border-primary-200">
                      {postDetail.category}
                    </span>
                    <h3 className="font-extrabold text-slate-900 text-base mt-1.5 leading-snug">
                      {postDetail.title}
                    </h3>
                  </div>

                  {/* Calculations Split fee block */}
                  <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200 space-y-3.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">배송비 정산 조건</span>
                      <span className="text-slate-700 font-extrabold bg-stone-200/80 px-2 py-0.5 rounded text-[10px]">
                        기본배송비: {postDetail.baseFee?.toLocaleString()}원
                      </span>
                    </div>

                    {postDetail.caseType === "A" ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-emerald-800 text-xs">
                        <div className="flex items-center gap-1.5 font-extrabold">
                          <CheckCircle size={14} className="text-emerald-500" />
                          <span>무료배송 확정!</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-emerald-700">
                          총 합산 주문금액 <span className="font-bold">{postDetail.targetPrice?.toLocaleString()}원</span> 초과 달성!
                          <span className="font-bold">{postDetail.participantCount}명</span>과 함께 배송비 <span className="font-bold">0원</span>으로 배송비를 아꼈어요!
                        </p>
                      </div>
                    ) : (
                      <div className="bg-primary-50 border border-primary-200 rounded-xl p-3.5 text-primary-900 text-xs">
                        <div className="flex items-center gap-1.5 font-extrabold text-primary-700">
                          <Info size={14} className="text-primary-500" />
                          <span>배송비를 분담해요</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-primary-600 font-medium">
                          합산금액이 무료배송 금액인 <span className="font-bold">{postDetail.targetPrice?.toLocaleString()}원</span> 미만으로 인당 1/N 배송비가 적용됩니다.
                        </p>
                        <div className="mt-2.5 pt-2 border-t border-primary-200/60 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-slate-500">현재 {postDetail.participantCount}명 분담 기준</span>
                          <span className="font-extrabold text-primary-700 text-xs bg-white px-2 py-1 rounded shadow-sm border border-primary-200">
                            인당 {postDetail.calculatedSplitFee?.toLocaleString()}원
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Basic Post Meta details */}
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-medium">띵장 (개설자)</span>
                      <span className="font-bold text-slate-700">👑 {postDetail.hostNickname}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-medium">수령가능 장소</span>
                      <div className="flex flex-wrap gap-1 max-w-[65%] justify-end">
                        {postDetail.locations.map((loc, i) => (
                          <span key={i} className="text-[10px] font-bold text-slate-600 bg-stone-100 px-1 py-0.5 rounded border border-stone-200">
                            {loc}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-medium">상세 구매링크</span>
                      <a href={postDetail.link} target="_blank" rel="noreferrer" className="font-bold text-sky-600 hover:underline">
                        👉 구매 링크 열기
                      </a>
                    </div>
                  </div>

                  {/* Real-time active members list with Deposit control panel */}
                  <div className="space-y-3.5">
                    <div className="flex justify-between items-center gap-2 flex-wrap">
                      <h4 className="text-xs font-black text-slate-800 tracking-wider uppercase">👥 띵원 목록 및 실시간 정산 ({postMembers.length}명)</h4>

                      <div className="flex items-center gap-1.5">
                        {/* Host Arrived trigger button */}
                        {postDetail.hostId === currentUser?.id && postDetail.status === 'CONFIRMED' && (
                          <button
                            onClick={handleMarkArrival}
                            className="bg-purple-500 hover:bg-purple-600 text-white font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-0.5 shadow-sm"
                          >
                            <Bell size={10} /> 물품도착 알림전송
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {postMembers.map((member, i) => {
                        const isMemberHost = member.userId === postDetail.hostId;
                        const isSelf = member.userId === currentUser?.id;

                        return (
                          <div key={i} className="bg-stone-50 border border-stone-200 rounded-xl p-2.5 text-xs">
                            <div className="flex justify-between items-center font-bold">
                              <div className="flex items-center gap-1">
                                <span className="text-slate-700">{member.nickname}</span>
                                {isMemberHost && <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded">띵장</span>}
                              </div>
                              <span className="text-slate-900 text-[10px] bg-stone-200 px-1.5 py-0.5 rounded">
                                {member.individualTotal?.toLocaleString()}원
                              </span>
                            </div>

                            {/* Items list */}
                            <ul className="mt-1.5 space-y-0.5 border-t border-stone-200/50 pt-1 text-[10px] text-slate-400">
                              {member.items?.map((item, j) => (
                                <li key={j} className="flex justify-between">
                                  <span>• {item.itemName} ({item.quantity}개)</span>
                                  <span>{(item.itemPrice * item.quantity).toLocaleString()}원</span>
                                </li>
                              ))}
                            </ul>

                            {/* Payment details controls */}
                            {!isMemberHost && (
                              <div className="mt-2 pt-2 border-t border-stone-200/50 flex items-center justify-between">
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${member.paymentStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                  member.paymentStatus === 'SENT' ? 'bg-blue-50 text-blue-600 border border-blue-100 animate-pulse' :
                                    'bg-red-50 text-red-600 border border-red-100'
                                  }`}>
                                  {member.paymentStatus === 'APPROVED' ? '💰 입금 확인 완료' :
                                    member.paymentStatus === 'SENT' ? '⏳ 송금완료 확인 대기' :
                                      '⚠️ 미입금'}
                                </span>

                                {/* Host manual approval control button */}
                                {postDetail.hostId === currentUser?.id && member.paymentStatus === 'SENT' && (
                                  <button
                                    onClick={() => handleApproveDeposit(member.userId)}
                                    className="bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-[9px] px-2 py-1 rounded transition-colors"
                                  >
                                    입금 확인 완료 처리
                                  </button>
                                )}

                                {/* Participant send payment trigger */}
                                {isSelf && member.paymentStatus === 'PENDING' && ['CONFIRMED', 'ARRIVED', 'COMPLETED'].includes(postDetail?.status) && (
                                  <div className="flex items-center gap-1.5">

                                    <button
                                      onClick={handleMarkPaymentSent}
                                      className="bg-primary-500 hover:bg-primary-600 text-white font-bold text-[9px] px-2 py-1 rounded transition-colors"
                                    >
                                      송금완료 확인 요청
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                          </div>
                        );
                      })}
                    </div>
                  </div>



                  {/* ---------------------------------------------------- */}
                  {/* Secure Settlement Bank account details (Confirmed only) */}
                  {/* ---------------------------------------------------- */}
                  <div className="border-t border-stone-200 pt-4 space-y-2.5">
                    <h4 className="text-xs font-black text-slate-800 tracking-wider uppercase flex items-center gap-1.5">
                      🛡️ 송금/정산 정보 (마스킹 실명제)
                    </h4>

                    {secureBankDetail ? (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900 shadow-sm relative overflow-hidden">
                        <div className="absolute right-3 top-3 h-10 w-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-500">
                          <Unlock size={18} />
                        </div>
                        <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200">
                          Unlocked
                        </span>
                        <p className="text-[10px] text-emerald-700 mt-2 font-semibold">띵장 실명마스킹 보안조항이 해제되었습니다.</p>
                        <div className="mt-3.5 bg-white border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                          <div>
                            <p className="text-[9px] text-slate-400 font-bold">예금주: {secureBankDetail.hostMaskedName}</p>
                            <p className="font-extrabold text-slate-800 text-sm tracking-tight">{secureBankDetail.bankAccount}</p>
                          </div>
                          <button
                            onClick={() => handleCopyAccount(secureBankDetail.bankAccount)}
                            className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 p-2 rounded-lg transition-colors"
                          >
                            {copySuccess ? <span className="text-[10px] font-bold px-0.5">복사됨!</span> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-stone-50 border border-dashed border-stone-300 rounded-2xl p-5 text-center flex flex-col items-center justify-center relative overflow-hidden">
                        <div className="h-10 w-10 bg-stone-200 rounded-full flex items-center justify-center text-stone-500 mb-2.5">
                          <Lock size={18} />
                        </div>
                        <h5 className="text-xs font-extrabold text-stone-700">예금주 실명/계좌 암호화</h5>
                        <p className="text-[9px] text-stone-400 mt-1 max-w-[220px]">
                          배송비 자동 매칭 조건이 충족되어 <span className="font-bold text-primary-500">공동구매 확정</span>상태가 되기 전까지 계좌 정보는 암호화 보호됩니다.
                        </p>
                        <div className="mt-3 bg-stone-200 text-stone-500 text-[10px] font-extrabold px-3 py-1.5 rounded-lg border border-stone-300 uppercase tracking-wider flex items-center gap-1 shadow-sm">
                          <Lock size={10} /> Secured by Platform
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ---------------------------------------------------- */}
                  {/* ARRIVED TIME TIMETABLE UI SECTION */}
                  {/* ---------------------------------------------------- */}
                  {['CONFIRMED', 'ARRIVED', 'COMPLETED'].includes(postDetail.status) && (
                    <div className="border-t border-stone-200 pt-4 space-y-3.5 animate-in slide-in-from-bottom duration-350">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-black text-slate-800 tracking-wider uppercase flex items-center gap-1">
                          <Calendar size={13} className="text-primary-500" />
                          <span>물품 수령 시간표 (1-Week Grid)</span>
                        </h4>

                        {postDetail.hostId === currentUser?.id && (
                          <button
                            onClick={handleSaveTimetable}
                            className="bg-primary-500 hover:bg-primary-600 text-white font-extrabold text-[9px] px-2.5 py-1.5 rounded-lg transition-colors shadow-sm"
                          >
                            설정 저장
                          </button>
                        )}
                      </div>

                      <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                        {postDetail.hostId === currentUser?.id
                          ? "💡 띵장 전용: 띵원들이 방문하여 수령할 수 있는 시간대를 탭하여 활성화 시킨 후 저장하세요."
                          : "💡 시간표 사용법: 띵장이 설정한 수령 가능 시간대를 클릭하면 선착순으로 수령 예약을 진행할 수 있습니다."
                        }
                      </p>

                      {/* Timetable grid layout */}
                      <div className="overflow-x-auto border border-stone-200 rounded-2xl bg-white shadow-inner p-2.5">
                        <table className="min-w-full text-center border-collapse">
                          <thead>
                            <tr>
                              <th className="p-1 text-[10px] font-bold text-slate-400">Time</th>
                              {WEEK_DAYS.map(day => (
                                <th key={day} className="p-1 text-[10px] font-extrabold text-slate-600">{day}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {TIME_SLOTS.map(time => (
                              <tr key={time} className="border-t border-stone-150">
                                <td className="p-1 text-[9px] font-bold text-slate-400 whitespace-nowrap">{time}</td>
                                {WEEK_DAYS.map(day => {
                                  const slotKey = `${day}-${time}`;

                                  // Analyze slot states:
                                  // 1. Is slot enabled by host (in postDetail.timetableSlots or tempTimetableSlots)?
                                  const isEnabled = postDetail.hostId === currentUser?.id
                                    ? tempTimetableSlots.includes(slotKey)
                                    : postDetail.timetableSlots.includes(slotKey);

                                  // 2. Is this slot booked by anyone?
                                  const booking = postBookings.find(b => b.slotKey === slotKey);
                                  const isBooked = !!booking;

                                  return (
                                    <td key={day} className="p-0.5">
                                      <button
                                        type="button"
                                        disabled={!isEnabled && postDetail.hostId !== currentUser?.id}
                                        onClick={() => {
                                          if (postDetail.hostId === currentUser?.id) {
                                            handleToggleTimetableSlot(day, time);
                                          } else {
                                            if (isBooked && booking.userId === currentUser.id) return; // already booked by self
                                            handleBookPickupSlot(slotKey);
                                          }
                                        }}
                                        className={`w-6 h-6 rounded-md text-[8px] font-bold transition-all flex items-center justify-center border ${isBooked
                                          ? 'bg-orange-200 border-orange-300 text-orange-800' // Booked slot (Pastel Orange)
                                          : isEnabled
                                            ? 'bg-primary-500 border-primary-600 text-white shadow-sm hover:scale-[1.08]' // Available (Vibrant Orange)
                                            : 'bg-stone-50 border-stone-200 text-slate-200' // Unavailable (White)
                                          }`}
                                        title={isBooked ? `${booking.nickname} (${booking.location})` : isEnabled ? '수령 가능 시간대' : '지정 외'}
                                      >
                                        {isBooked ? '👥' : isEnabled ? '✔' : ''}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Interactive popup for slot booking gate selector */}
                      {selectedPickupSlotKey && (
                        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 text-xs space-y-3.5 animate-in slide-in-from-top duration-200">
                          <div>
                            <span className="font-extrabold text-orange-800">📅 수령장소 선택 예약 ({selectedPickupSlotKey})</span>
                            <p className="text-[10px] text-orange-700 mt-0.5">선택하신 시간대에 물품을 수령할 게이트 장소를 지정해 주세요.</p>
                          </div>

                          <select
                            value={selectedPickupGate}
                            onChange={(e) => setSelectedPickupGate(e.target.value)}
                            className="w-full bg-white border border-orange-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none"
                          >
                            {postDetail.locations.map(loc => (
                              <option key={loc} value={loc}>{loc}</option>
                            ))}
                          </select>

                          <div className="flex gap-2">
                            <button
                              onClick={() => setSelectedPickupSlotKey(null)}
                              className="w-1/2 bg-stone-100 hover:bg-stone-200 text-slate-600 font-bold py-2 rounded-lg transition-colors text-[11px]"
                            >
                              취소
                            </button>
                            <button
                              onClick={handleConfirmPickupBooking}
                              className="w-1/2 bg-primary-500 hover:bg-primary-600 text-white font-extrabold py-2 rounded-lg transition-colors text-[11px] shadow-sm"
                            >
                              예약 승인
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Active Bookings list summary board (Co-location Grouped & Ascending Sorted) */}
                      <div className="space-y-3">
                        <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">🛒 실시간 띵 현황</span>
                        <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                          {postBookings.length === 0 ? (
                            <p className="text-[10px] text-slate-400 font-medium italic text-center py-3 bg-stone-50 rounded-2xl border border-stone-200">등록된 수령 예약 건이 존재하지 않습니다.</p>
                          ) : (
                            groupBookings(postBookings)
                              .sort((a, b) => getSlotTimestamp(a.slotKey) - getSlotTimestamp(b.slotKey))
                              .map((group, index) => (
                                <div key={index} className="bg-stone-50 border border-stone-250 rounded-2xl p-3 space-y-2 text-[10px] shadow-sm">
                                  <div className="flex items-center justify-between">
                                    <span className="font-extrabold text-slate-700 flex items-center gap-1 bg-white border border-stone-200 px-2 py-0.5 rounded-md shadow-sm">
                                      <Clock size={11} className="text-primary-500" />
                                      <span>{group.slotKey}</span>
                                    </span>
                                    <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold border border-orange-250">
                                      📍 {group.location}
                                    </span>
                                  </div>
                                  <div className="bg-white rounded-xl p-2 border border-stone-150 space-y-1">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">📦 수령 예정 띵원 ({group.members.length}명)</span>
                                    <div className="flex flex-wrap gap-1">
                                      {group.members.map((m, idx) => (
                                        <span key={idx} className="bg-stone-50 text-slate-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-stone-200">
                                          👤 {m.nickname}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </div>

                    </div>
                  )}

                  {/* Join action button */}
                  {postDetail.status === "OPEN" && (
                    <button
                      onClick={() => setIsJoinModalOpen(true)}
                      className="w-full bg-primary-500 hover:bg-primary-600 text-white font-extrabold py-3.5 rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-sm"
                    >
                      <span>나도 같이 띵 합류하기! (참여 신청)</span>
                      <ArrowRight size={16} />
                    </button>
                  )}

                </div>
              )}
            </section>

          </main>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3. VIEW TAB: Dedicated Notification Center Page */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'notifications' && (
        <div className="max-w-4xl mx-auto px-4 mt-8 animate-in fade-in duration-200">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-xl font-black text-slate-900 font-sans flex items-center gap-2">
                🔔 몇 띵?! 실시간 알림함
                <span className="bg-primary-50 text-primary-500 text-xs font-extrabold px-2.5 py-0.5 rounded-full border border-primary-200">
                  총 {notifications.length}개
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">참여 중인 공동구매의 매칭 확정, 무산, 물품 도착 등 모든 진행 상황을 모니터링합니다.</p>
            </div>
            {notifications.some(n => n.read === 0) && (
              <button
                type="button"
                onClick={async () => {
                  for (const n of notifications) {
                    if (n.read === 0) await handleMarkNotificationRead(n.id);
                  }
                }}
                className="text-xs font-bold text-primary-500 hover:underline bg-primary-50 px-3.5 py-2 rounded-xl border border-primary-200 transition-all cursor-pointer"
              >
                모두 읽음 표시
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="bg-white rounded-3xl p-16 border border-stone-200 text-center flex flex-col items-center justify-center text-slate-400 shadow-sm">
              <div className="h-16 w-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-400 mb-4 text-3xl">📭</div>
              <h3 className="font-bold text-slate-800 text-base">수신된 알림 내역이 존재하지 않습니다.</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">공동구매 띵에 참가하거나 방을 만들면 상태 변화 알림이 실시간 수신됩니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notif) => {
                const isUnread = notif.read === 0;

                let typeStyles = {
                  border: 'border-stone-250',
                  bg: isUnread ? 'bg-white' : 'bg-stone-50/70 opacity-75',
                  badgeBg: 'bg-stone-100 text-slate-600 border-stone-200',
                  iconBg: 'bg-stone-100 text-slate-600',
                  icon: '🔔',
                  label: '일반'
                };

                if (notif.type === 'CONFIRMED') {
                  typeStyles = {
                    border: isUnread ? 'border-emerald-500 shadow-sm ring-1 ring-emerald-500/5' : 'border-stone-250',
                    bg: isUnread ? 'bg-emerald-50/20' : 'bg-stone-50/70 opacity-75',
                    badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
                    iconBg: 'bg-emerald-100 text-emerald-600',
                    icon: '🎉',
                    label: '공구 확정'
                  };
                } else if (notif.type === 'CANCELLATION') {
                  typeStyles = {
                    border: isUnread ? 'border-red-500 shadow-sm ring-1 ring-red-500/5' : 'border-stone-250',
                    bg: isUnread ? 'bg-red-50/10' : 'bg-stone-50/70 opacity-75',
                    badgeBg: 'bg-red-100 text-red-800 border-red-200',
                    iconBg: 'bg-red-100 text-red-600',
                    icon: '🚨',
                    label: '공구 조정'
                  };
                } else if (notif.type === 'ARRIVAL') {
                  typeStyles = {
                    border: isUnread ? 'border-purple-500 shadow-sm ring-1 ring-purple-500/5' : 'border-stone-250',
                    bg: isUnread ? 'bg-purple-50/15' : 'bg-stone-50/70 opacity-75',
                    badgeBg: 'bg-purple-100 text-purple-800 border-purple-200',
                    iconBg: 'bg-purple-100 text-purple-600',
                    icon: '📦',
                    label: '물품 도착'
                  };

                }

                return (
                  <div
                    key={notif.id}
                    className={`rounded-3xl p-5 border transition-all ${typeStyles.border} ${typeStyles.bg} flex gap-4 items-start relative`}
                  >
                    <div className={`h-11 w-11 rounded-2xl flex items-center justify-center text-lg ${typeStyles.iconBg} shrink-0`}>
                      {typeStyles.icon}
                    </div>

                    <div className="space-y-1.5 w-full pr-10">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${typeStyles.badgeBg}`}>
                          {typeStyles.label}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">
                          {new Date(notif.createdAt).toLocaleDateString()} {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isUnread && (
                          <span className="bg-primary-500 h-1.5 w-1.5 rounded-full animate-ping" />
                        )}
                      </div>
                      <h4 className="text-sm font-extrabold text-slate-800 leading-snug">{notif.title}</h4>
                      <p className="text-xs text-slate-500 leading-relaxed font-semibold whitespace-pre-line bg-stone-50/30 p-2.5 rounded-xl border border-stone-100/40">
                        {notif.content}
                      </p>
                    </div>

                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => handleMarkNotificationRead(notif.id)}
                        className="absolute right-5 top-5 bg-stone-100 hover:bg-stone-200 text-slate-600 hover:text-slate-800 text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg border border-stone-200 transition-colors cursor-pointer"
                      >
                        읽음
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 2. VIEW TAB: Enhanced MyPage View */}
      {/* ---------------------------------------------------- */}
      {activeTab === 'mypage' && currentUser && (
        <div className="max-w-4xl mx-auto px-4 mt-8 animate-in fade-in duration-200">

          <div className="bg-white rounded-3xl p-6 border border-stone-200 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 bg-gradient-to-tr from-primary-500 to-orange-400 rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg shadow-primary-500/20">
                🚀
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-slate-900">{currentUser.nickname}</h3>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${currentUser.provider === 'kakao' ? 'bg-amber-100 border-amber-200 text-amber-800' :
                    currentUser.provider === 'naver' ? 'bg-emerald-100 border-emerald-200 text-emerald-800' :
                      'bg-slate-100 border-slate-200 text-slate-800'
                    }`}>
                    {currentUser.provider?.toUpperCase()} 소셜 로그인 계정
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5"> 띵 해요</p>
              </div>
            </div>

            {/* Strict Payment Strike/Sanctions display */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 flex gap-6 text-center shadow-inner">
              <div>
                <span className="text-[10px] font-bold text-slate-400">누적 벌점/연체 횟수</span>
                <p className={`text-xl font-black ${currentUser.penaltyCount > 0 ? 'text-red-500' : 'text-slate-700'}`}>
                  {currentUser.penaltyCount}회
                </p>
              </div>
              <div className="border-l border-stone-200" />
              <div>
                <span className="text-[10px] font-bold text-slate-400">이용 등급 / 상태</span>
                <p className={`text-xs font-extrabold mt-1 px-3 py-1 rounded-full border ${currentUser.status === 'BANNED' ? 'bg-red-100 border-red-200 text-red-600' :
                  currentUser.status.startsWith('SUSPENDED') ? 'bg-orange-100 border-orange-200 text-orange-600' :
                    'bg-emerald-100 border-emerald-200 text-emerald-600'
                  }`}>
                  {currentUser.status === 'BANNED' ? '영구정지 (BAN)' :
                    currentUser.status === 'SUSPENDED_3D' ? '🚫 3일 이용정지' :
                      currentUser.status === 'SUSPENDED_30D' ? '🚫 30일 이용정지' :
                        '✔ ACTIVE (정상)'}
                </p>
              </div>
            </div>
          </div>

          {/* User Specific Hosted/Joined posts Lists */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">

            {/* 1. HOSTED */}
            <div className="space-y-4">
              <h3 className="text-base font-black text-slate-800 flex items-center gap-1.5">
                👑 띵장 내역 (내가 개설한 띵)
              </h3>

              {hostedPosts.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 border border-stone-200 text-center text-xs text-slate-400 italic">
                  띵을 개설하지 않았습니다. 띵장으로 배송비를 절약해 보세요!
                </div>
              ) : (
                <div className="space-y-3">
                  {hostedPosts.map(post => (
                    <div
                      key={post.id}
                      onClick={() => {
                        setSelectedPostId(post.id);
                        setActiveTab('board');
                      }}
                      className="bg-white border border-stone-200 rounded-2xl p-4 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between gap-3"
                    >
                      <div>
                        <h4 className="font-extrabold text-xs text-slate-800 line-clamp-1">{post.title}</h4>
                        <div className="flex gap-1.5 mt-1.5">
                          {post.locations.map((loc, i) => (
                            <span key={i} className="text-[9px] text-slate-400 bg-stone-100 px-1 rounded">{loc}</span>
                          ))}
                        </div>
                      </div>
                      <span className="shrink-0 bg-primary-50 text-primary-500 font-extrabold text-[10px] px-2.5 py-1 rounded-full border border-primary-200">
                        {post.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 2. JOINED */}
            <div className="space-y-4">
              <h3 className="text-base font-black text-slate-800 flex items-center gap-1.5">
                🙋‍♀️ 띵원 내역 (내가 참여한 띵)
              </h3>

              {joinedPosts.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 border border-stone-200 text-center text-xs text-slate-400 italic">
                  내가 참여한 띵 내역이 비어있습니다. 띵에 참여해서 배송비를 절약해 보세요!
                </div>
              ) : (
                <div className="space-y-3">
                  {joinedPosts.map(post => (
                    <div
                      key={post.id}
                      onClick={() => {
                        setSelectedPostId(post.id);
                        setActiveTab('board');
                      }}
                      className="bg-white border border-stone-200 rounded-2xl p-4 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between gap-3"
                    >
                      <div>
                        <h4 className="font-extrabold text-xs text-slate-800 line-clamp-1">{post.title}</h4>
                        <div className="flex gap-1.5 mt-1.5">
                          {post.locations.map((loc, i) => (
                            <span key={i} className="text-[9px] text-slate-400 bg-stone-100 px-1 rounded">{loc}</span>
                          ))}
                        </div>
                      </div>
                      <span className="shrink-0 bg-stone-100 text-slate-600 font-extrabold text-[10px] px-2.5 py-1 rounded-full border border-stone-200">
                        {post.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>


          </div>

        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* MODAL 1: Create Group Buy Modal */}
      {/* ---------------------------------------------------- */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150">

            <div className="p-6 border-b border-stone-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-1.5">
                  🛒 N Thing?! 공동구매 개설
                </h3>
                <p className="text-xs text-slate-400">수령 지정장소 다중선택, 마스킹 보안 계좌가 자동 매칭됩니다.</p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 text-2xl font-bold font-sans"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreatePost} className="p-6 space-y-4">

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">띵방 이름 / 방 제목 *</label>
                <input
                  type="text"
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                  placeholder="예: 텍문/나리문 무선제본 노트 10개 세트 쉐어"
                  value={newPost.title}
                  onChange={(e) => setNewPost(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Category Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">카테고리 *</label>
                  <select
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold"
                    value={newPost.category}
                    onChange={(e) => setNewPost(prev => ({ ...prev, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>{c.emoji} {c.id}</option>
                    ))}
                  </select>
                </div>

                {/* Host's Real Name (For secure masking 서*은) */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">호스트 실명 (계좌 예금주명) *</label>
                  <input
                    type="text"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold placeholder-red-300"
                    placeholder="예: 서은아"
                    value={newPost.hostRealName}
                    onChange={(e) => setNewPost(prev => ({ ...prev, hostRealName: e.target.value }))}
                  />
                </div>
              </div>

              {/* Multi-Selection Checkbox Group of 20 Predefined Gates */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">
                  📍 희망 수령 지정장소 다중선택 *
                </label>
                <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto border border-stone-200 rounded-2xl bg-stone-50/50 p-3 shadow-inner">
                  {STANDARD_LOCATIONS.map(gate => {
                    const isChecked = newPost.locations.includes(gate);
                    return (
                      <label
                        key={gate}
                        onClick={() => handleToggleLocationCheckbox(gate)}
                        className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-[10px] font-bold cursor-pointer select-none transition-all ${isChecked ? 'bg-primary-500 border-primary-600 text-white' : 'bg-white border-stone-200 text-slate-600 hover:border-stone-300'
                          }`}
                      >
                        <div className="shrink-0">
                          {isChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                        </div>
                        <span>{gate}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">띵장이 나눔 가능한 장소를 중복선택해 주세요.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">주문 혹은 상세 장바구니 링크</label>
                <input
                  type="url"
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                  placeholder="예: 상품 장바구니 매장 링크"
                  value={newPost.link}
                  onChange={(e) => setNewPost(prev => ({ ...prev, link: e.target.value }))}
                />
              </div>

              {/* Price configurations */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">목표달성 조건금액 *</label>
                  <input
                    type="number"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold"
                    placeholder="예: 20000"
                    value={newPost.targetPrice}
                    onChange={(e) => setNewPost(prev => ({ ...prev, targetPrice: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">기본 배송비 *</label>
                  <input
                    type="number"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold"
                    placeholder="예: 2500"
                    value={newPost.baseFee}
                    onChange={(e) => setNewPost(prev => ({ ...prev, baseFee: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1">자동확정 배송비 목표 *</label>
                  <input
                    type="number"
                    required
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold"
                    placeholder="예: 1000"
                    value={newPost.autoConfirmFeeLimit}
                    onChange={(e) => setNewPost(prev => ({ ...prev, autoConfirmFeeLimit: e.target.value }))}
                  />
                </div>
              </div>

              {/* Host Bank details */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">정산용 입금 계좌번호 (보안 적용) *</label>
                <input
                  type="text"
                  required
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:outline-none font-bold placeholder-red-300"
                  placeholder="예: 토스뱅크 1000-1234-5678"
                  value={newPost.bankAccount}
                  onChange={(e) => setNewPost(prev => ({ ...prev, bankAccount: e.target.value }))}
                />
                <p className="text-[9px] text-slate-400 mt-1 font-semibold">⚠️ 띵 확정 전까지 예금주 실명 마스킹 및 계좌번호 노출 방지가 철저히 자동 적용됩니다.</p>
              </div>

              {/* Host item registers */}
              <div className="border-t border-stone-150 pt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-slate-800">🛍️ 띵장 본인 구매 상품 등록 *</h4>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="text-xs font-bold text-primary-500 hover:text-primary-600 flex items-center gap-0.5"
                  >
                    + 상품 추가
                  </button>
                </div>

                {newPost.items.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      required
                      placeholder="상품명 (예: 무선제본 격자 노트 A4)"
                      className="w-2/3 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs"
                      value={item.itemName}
                      onChange={(e) => handleItemChange(idx, 'itemName', e.target.value)}
                    />
                    <input
                      type="number"
                      required
                      placeholder="가격"
                      className="w-1/3 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                      value={item.itemPrice}
                      onChange={(e) => handleItemChange(idx, 'itemPrice', e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="bg-stone-100 hover:bg-stone-200 text-slate-600 text-xs font-bold px-4 py-2.5 rounded-xl transition-all"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="bg-primary-500 hover:bg-primary-600 text-white text-xs font-extrabold px-5 py-2.5 rounded-xl transition-all active:scale-[0.98]"
                >
                  몇띵?! 개설 완료
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* MODAL 2: Join Participation Flow Modal */}
      {/* ---------------------------------------------------- */}
      {isJoinModalOpen && postDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-stone-200 animate-in fade-in zoom-in-95 duration-150">

            <div className="p-6 border-b border-stone-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg flex items-center gap-1.5">
                  🙋‍♀️ 띵 참여 접수
                </h3>
                <p className="text-xs text-slate-400">"{postDetail.title}" 에 상품을 띵쉐어하여 동참합니다.</p>
              </div>
              <button
                onClick={() => setIsJoinModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 text-2xl font-bold font-sans"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleJoinSubmit} className="p-6 space-y-5">

              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 text-xs space-y-2">
                <div className="flex justify-between font-medium">
                  <span className="text-slate-400">현재 총 합산액</span>
                  <span className="text-slate-700 font-bold">{postDetail.totalAccumulated?.toLocaleString()}원</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-400">무료배송 금액</span>
                  <span className="text-slate-700 font-bold">{postDetail.targetPrice?.toLocaleString()}원</span>
                </div>
                <div className="flex justify-between font-medium text-primary-500">
                  <span className="font-extrabold">나의 주문 예정액</span>
                  <span className="font-extrabold text-sm">{getJoinFormTotal().toLocaleString()}원</span>
                </div>
              </div>

              {/* Order input list builder */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-slate-800">🛍️ 구매 희망 품목 상세 입력</h4>
                  <button
                    type="button"
                    onClick={handleAddJoinField}
                    className="text-xs font-bold text-primary-500 hover:text-primary-600 flex items-center gap-0.5"
                  >
                    + 상품 추가
                  </button>
                </div>

                {joinItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="text"
                      required
                      placeholder="상품명 (예: 노트)"
                      className="w-1/2 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary-500"
                      value={item.itemName}
                      onChange={(e) => handleJoinItemChange(idx, 'itemName', e.target.value)}
                    />
                    <input
                      type="number"
                      required
                      placeholder="가격 (원)"
                      className="w-1/4 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:ring-1 focus:ring-primary-500"
                      value={item.itemPrice}
                      onChange={(e) => handleJoinItemChange(idx, 'itemPrice', e.target.value)}
                    />
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="수량"
                      className="w-1/4 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-center focus:ring-1 focus:ring-primary-500"
                      value={item.quantity}
                      onChange={(e) => handleJoinItemChange(idx, 'quantity', e.target.value)}
                    />
                  </div>
                ))}
              </div>

              {/* Consent check */}
              <div className="bg-orange-50/50 border border-orange-200 rounded-2xl p-4 space-y-3">
                <h4 className="text-xs font-extrabold text-orange-800 flex items-center gap-1">
                  💡 배송비 자동 확정 상한선 약관동의
                </h4>
                <p className="text-[10px] text-orange-700/90 leading-relaxed font-medium">
                  띵장의 1/N 배송비 분담 상한선인 <span className="font-bold text-slate-800">인당 {postDetail.autoConfirmFeeLimit?.toLocaleString()}원</span> 동의하에 합류합니다.
                  주문자가 증가하여 분담 배송비가 한계 금액 이하로 하락할 시, 방 상태는 서버 SQL 트랜잭션에 의해 즉각 <span className="font-bold text-emerald-600"> 공구 확정</span> 상태가 됩니다.
                </p>

                <label
                  onClick={() => setJoinConsent(prev => !prev)}
                  className="flex items-start gap-2.5 cursor-pointer select-none pt-2 text-[11px] font-bold text-slate-700"
                >
                  <div className="text-primary-500 shrink-0 mt-0.5">
                    {joinConsent ? <CheckSquare size={16} className="fill-primary-50" /> : <Square size={16} />}
                  </div>
                  <span>
                    띵장의 자동 승인 한도선 동의 및 수락서에 서명하며, 배송 물품 도착 시 시간표 예약 및 24시간 내 엄격한 입금 정산 불이행 시 벌점 조항에 수락합니다. *
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-stone-200">
                <button
                  type="button"
                  onClick={() => setIsJoinModalOpen(false)}
                  className="bg-stone-100 hover:bg-stone-200 text-slate-600 text-xs font-bold px-4 py-2.5 rounded-xl transition-all"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={!joinConsent}
                  className={`text-white text-xs font-extrabold px-5 py-2.5 rounded-xl transition-all active:scale-[0.98] ${joinConsent ? 'bg-primary-500 hover:bg-primary-600 shadow-md' : 'bg-slate-300 cursor-not-allowed shadow-none'
                    }`}
                >
                  띵 합류 신청완료
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* MODAL 3: Confirmed Settlement Notification Modal */}
      {postDetail && postDetail.status === 'CONFIRMED' && postMembers.some(m => m.userId === currentUser?.id && m.userId !== postDetail.hostId) && !hasDismissedConfirmedModal[postDetail.id] && (() => {
        const userMember = postMembers.find(m => m.userId === currentUser?.id);
        if (!userMember) return null;

        const itemsCost = userMember.individualTotal || 0;
        const splitFee = postDetail.calculatedSplitFee || 0;
        const grandTotal = itemsCost + splitFee;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-stone-250 p-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="text-center space-y-2">
                <div className="h-12 w-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl">
                  🎉
                </div>
                <h3 className="text-lg font-black text-slate-900">공동구매 매칭 확정 안내</h3>
                <p className="text-xs text-slate-500">배송비 자동 승인 한도 충족으로 매칭이 완료되었습니다.</p>
              </div>

              <div className="mt-5 bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
                {secureBankDetail ? (
                  <div className="space-y-1">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">🏦 송금 계좌 정보 (띵장)</span>
                    <div className="flex justify-between items-center bg-white border border-stone-200 p-2.5 rounded-xl">
                      <div className="overflow-hidden mr-2">
                        <p className="text-[10px] text-slate-400 font-bold">예금주: {secureBankDetail.hostMaskedName}</p>
                        <p className="text-sm font-black text-slate-800 tracking-tight truncate">{secureBankDetail.bankAccount}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(secureBankDetail.bankAccount);
                          setCopySuccess(true);
                          setTimeout(() => setCopySuccess(false), 2000);
                        }}
                        className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-emerald-200 transition-colors shrink-0"
                      >
                        {copySuccess ? "복사완료" : "복사"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 bg-white border border-dashed border-stone-200 rounded-xl">
                    <p className="text-xs text-slate-400 font-bold">계좌 정보를 불러오는 중입니다...</p>
                  </div>
                )}

                <div className="border-t border-stone-200/60 pt-3 space-y-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">📊 개인별 정산 요약</span>

                  {/* Item list */}
                  <div className="max-h-24 overflow-y-auto pr-1 space-y-1">
                    {userMember.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-[11px] text-slate-500 font-medium">
                        <span>{item.itemName} ({item.quantity}개)</span>
                        <span>{(item.itemPrice * item.quantity).toLocaleString()}원</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-dashed border-stone-200 pt-2 flex justify-between text-[11px] font-bold text-slate-600">
                    <span>상품 금액 합계</span>
                    <span>{itemsCost.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-bold text-slate-600">
                    <span>분할 배송비 (1/N)</span>
                    <span>{splitFee.toLocaleString()}원</span>
                  </div>
                  <div className="border-t border-stone-200 pt-2 flex justify-between text-xs font-black text-primary-500 bg-primary-50/50 p-2 rounded-xl">
                    <span>총 입금 요청 금액</span>
                    <span>{grandTotal.toLocaleString()}원</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => setHasDismissedConfirmedModal(prev => ({ ...prev, [postDetail.id]: true }))}
                  className="w-1/3 bg-stone-100 hover:bg-stone-200 text-slate-600 text-xs font-bold py-3 rounded-xl transition-all"
                >
                  나중에 송금
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleMarkPaymentSent();
                    setHasDismissedConfirmedModal(prev => ({ ...prev, [postDetail.id]: true }));
                  }}
                  className="w-2/3 bg-primary-500 hover:bg-primary-600 text-white text-xs font-extrabold py-3 rounded-xl transition-all shadow-md shadow-primary-500/15"
                >
                  송금 완료 신고하기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL 4: Rescue Mode Dialog */}
      {isRescueModalOpen && postDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-stone-250 p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="h-12 w-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-2xl">
                🚨
              </div>
              <h3 className="text-lg font-black text-slate-900">공구 재오픈 & 미입금 방출</h3>
              <p className="text-xs text-slate-500">정산 기한을 넘긴 미입금 멤버를 방출하고 대책을 수립합니다.</p>
            </div>

            {/* Non-paying members count */}
            <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-4 text-xs text-red-800">
              <span className="font-extrabold block">⚠️ 방출 대상 미입금 띵원</span>
              <ul className="mt-1.5 space-y-0.5 font-bold list-disc pl-4 text-[11px]">
                {postMembers
                  .filter(m => m.userId !== postDetail.hostId && m.paymentStatus === 'PENDING')
                  .map((m, idx) => (
                    <li key={idx}>
                      {m.nickname} ({m.individualTotal?.toLocaleString()}원 미입금)
                    </li>
                  ))}
              </ul>
              <p className="mt-2 text-[10px] text-red-755 leading-relaxed font-semibold">
                방출할 시 해당 띵원들의 신청 정보는 삭제되며, 띵에서 제외됩니다.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">⚙️ 수립할 조치 전략 선택</span>

              <label
                onClick={() => setRescueStrategy('RE_OPEN')}
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${rescueStrategy === 'RE_OPEN'
                  ? 'bg-primary-50 border-primary-300 ring-2 ring-primary-500/10'
                  : 'bg-stone-50 border-stone-200 hover:border-stone-300'
                  }`}
              >
                <input
                  type="radio"
                  name="rescueStrategy"
                  checked={rescueStrategy === 'RE_OPEN'}
                  onChange={() => setRescueStrategy('RE_OPEN')}
                  className="mt-1 h-4 w-4 text-primary-500 focus:ring-0 cursor-pointer"
                />
                <div>
                  <p className="text-xs font-extrabold text-slate-800">Option A: 공구방 재모집</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed font-medium">
                    미입금 인원을 방출하고, 방 상태를 모집 중 상태로 복구하여 신규 띵원을 추가 모집합니다.
                  </p>
                </div>
              </label>

              <label
                onClick={() => setRescueStrategy('SPLIT_REMAINING')}
                className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${rescueStrategy === 'SPLIT_REMAINING'
                  ? 'bg-primary-50 border-primary-300 ring-2 ring-primary-500/10'
                  : 'bg-stone-50 border-stone-200 hover:border-stone-300'
                  }`}
              >
                <input
                  type="radio"
                  name="rescueStrategy"
                  checked={rescueStrategy === 'SPLIT_REMAINING'}
                  onChange={() => setRescueStrategy('SPLIT_REMAINING')}
                  className="mt-1 h-4 w-4 text-primary-500 focus:ring-0 cursor-pointer"
                />
                <div>
                  <p className="text-xs font-extrabold text-slate-800">Option B: 배송비 재분담 </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed font-medium">
                    미입금 인원을 제외하고, 확정 상태를 유지합니다. 남은 인원끼리 배송비를 1/N 재정산하여 정산 금액이 자동 갱신됩니다.
                  </p>
                </div>
              </label>
            </div>

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                disabled={rescueLoading}
                onClick={() => setIsRescueModalOpen(false)}
                className="w-1/3 bg-stone-100 hover:bg-stone-200 text-slate-600 text-xs font-bold py-3 rounded-xl transition-all"
              >
                취소
              </button>
              <button
                type="button"
                disabled={rescueLoading}
                onClick={() => handleRescueGroupBuy(rescueStrategy)}
                className="w-2/3 bg-red-500 hover:bg-red-600 text-white text-xs font-extrabold py-3 rounded-xl transition-all shadow-md shadow-red-500/15 flex items-center justify-center gap-1.5"
              >
                {rescueLoading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <>적용 및 구출 실행</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
