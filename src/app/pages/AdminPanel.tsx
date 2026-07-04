import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { subscribeToRealtime } from "../lib/mqttApi";
import { 
  Users, 
  Settings, 
  Activity, 
  Wifi, 
  Server, 
  AlertCircle,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Radio
} from "lucide-react";

// Dynamic state fetched from backend
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const defaultUsers: any[] = []
const defaultSensors: any[] = []


export default function AdminPanel() {
  const [thresholdKRL, setThresholdKRL] = useState("60");
  const [thresholdKAI, setThresholdKAI] = useState("70");
  const [users, setUsers] = useState(defaultUsers);
  const [sensors, setSensors] = useState(defaultSensors);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [errorLogs, setErrorLogs] = useState<any[]>([]);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [showSensorModal, setShowSensorModal] = useState(false);
  const [sensorModalMode, setSensorModalMode] = useState<'add' | 'edit'>('edit');
  const [sensorConfigData, setSensorConfigData] = useState<any>({ topic: '', clientId: '', username: '', enabled: true, location: '' });
  const [serverOnline, setServerOnline] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [networkStatus, setNetworkStatus] = useState("Checking");
  const [networkLatency, setNetworkLatency] = useState<number | null>(null);
  const [lastMqttSeen, setLastMqttSeen] = useState<number | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchSensors();
    fetchLogs();
    fetchSettings();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    const pollStatus = async () => {
      const startedAt = performance.now();
      try {
        const res = await fetch(`${API_BASE}/api/monitoring/realtime/`, { cache: "no-store" });
        const latency = Math.round(performance.now() - startedAt);
        if (cancelled) return;

        setServerOnline(res.ok);
        setNetworkLatency(latency);
        if (!res.ok) {
          setNetworkStatus("Offline");
          setMqttConnected(false);
          return;
        }

        const data = await res.json();
        const latest = data?.latest || {};
        let newestTs = 0;
        Object.values(latest).forEach((entry: any) => {
          const parsed = entry?.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
          if (!Number.isNaN(parsed) && parsed > newestTs) newestTs = parsed;
        });

        if (newestTs > 0) setLastMqttSeen(newestTs);
        const ageMs = newestTs > 0 ? Date.now() - newestTs : Number.POSITIVE_INFINITY;
        setMqttConnected(ageMs <= 120000);

        if (latency < 120) setNetworkStatus("Stable");
        else if (latency < 300) setNetworkStatus("Warning");
        else setNetworkStatus("Unstable");
      } catch (e) {
        if (cancelled) return;
        setServerOnline(false);
        setMqttConnected(false);
        setNetworkStatus("Offline");
        setNetworkLatency(null);
      }
    };

    pollStatus();
    const intervalId = window.setInterval(pollStatus, 5000);

    ws = subscribeToRealtime((message: any) => {
      const payload = message?.data ?? message;
      if (payload?.topic) {
        setLastMqttSeen(Date.now());
        setMqttConnected(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (ws) ws.close();
    };
  }, []);

  const formatLastPing = () => {
    if (!lastMqttSeen) return "-";
    const sec = Math.max(0, Math.floor((Date.now() - lastMqttSeen) / 1000));
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  };

  async function fetchUsers() {
    try {
      const token = localStorage.getItem('fm_token');
      const headers:any = {};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/users/`,{headers});
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function addUser() {
    // open add-user modal
    openUserModal('add', { id: null, name: '', email: '', password: '' });
  }

  async function deleteUser(id:number){
    if(!confirm('Delete user?')) return;
    const token = localStorage.getItem('fm_token');
    const headers:any = {'Content-Type':'application/json'};
    if(token) headers['Authorization'] = `Bearer ${token}`;
    await fetch(`${API_BASE}/api/monitoring/admin/users/${id}/`,{method:'DELETE', headers});
    fetchUsers();
  }

  async function editUser(user:any){
    // open edit-user modal
    openUserModal('edit', { id: user.id, name: user.name || '', email: user.email || '', password: '' });
  }

  async function makeAdmin(user:any){
    if (user.role === 'admin') return;
    if(!confirm(`Set ${user.name} as admin?`)) return;
    const token = localStorage.getItem('fm_token');
    const headers:any = {'Content-Type':'application/json'};
    if(token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/api/monitoring/admin/users/${user.id}/`,{
      method:'PUT',
      headers,
      body: JSON.stringify({ role: 'admin' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Role update failed: ${body.error || res.statusText}`);
      return;
    }
    fetchUsers();
  }

  // modal state + helpers
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalMode, setUserModalMode] = useState<'add'|'edit'>('add');
  const [userModalData, setUserModalData] = useState<any>({ id: null, name: '', email: '', password: '' });

  function openUserModal(mode:'add'|'edit', data:any){
    setUserModalMode(mode);
    setUserModalData(data);
    setShowUserModal(true);
  }

  function closeUserModal(){
    setShowUserModal(false);
    setUserModalData({ id: null, name: '', email: '', password: '' });
  }

  async function handleUserModalSave(){
    const { id, name, email, password } = userModalData;
    if(!name || !email){ alert('Name and email required'); return; }
    if(!email.toLowerCase().endsWith('@kai.id')){ alert('Email must end with @kai.id'); return; }
    try{
      if(userModalMode === 'add'){
        const res = await fetch(`${API_BASE}/api/monitoring/admin/users/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});
        if(!res.ok){ const b = await res.json().catch(()=>({})); alert('Create failed: '+(b.error||res.statusText)); return; }
      } else {
        const payload:any = { name, email };
        if(password) payload.password = password;
        const res = await fetch(`${API_BASE}/api/monitoring/admin/users/${id}/`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(!res.ok){ const b = await res.json().catch(()=>({})); alert('Update failed: '+(b.error||res.statusText)); return; }
      }
      await fetchUsers();
      closeUserModal();
    }catch(e){ console.error(e); alert('Save failed'); }
  }

  async function fetchSensors(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/sensors/`,{headers});
      if(!res.ok) throw new Error('fail');
      const data = await res.json();
      setSensors(data);
    }catch(e){console.error(e)}
  }

  function openSensorModal(sensor:any, mode: 'add' | 'edit' = 'edit'){
    setSensorModalMode(mode);
    setSensorConfigData({
      topic: mode === 'add' ? '' : sensor.topic,
      clientId: mode === 'add' ? '' : sensor.clientId || '',
      username: mode === 'add' ? '' : sensor.username || '',
      enabled: mode === 'add' ? true : sensor.status !== 'Disabled',
      location: sensor.location || '',
    });
    setShowSensorModal(true);
  }

  function closeSensorModal(){
    setShowSensorModal(false);
    setSensorModalMode('edit');
    setSensorConfigData({ topic: '', clientId: '', username: '', enabled: true, location: '' });
  }

  async function handleCalibrateSensor(sensor:any){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/sensors/calibrate/`, {
        method:'POST',
        headers,
        body: JSON.stringify({ topic: sensor.topic })
      });
      if(!res.ok){ const body = await res.json().catch(()=>({})); alert('Calibrate failed: '+(body.error||res.statusText)); return; }
      await fetchSensors();
      alert(`Calibration updated for ${sensor.topic}`);
    }catch(e){ console.error(e); alert('Failed to calibrate sensor'); }
  }

  async function saveSensorConfiguration(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/sensors/configure/`, {
        method:'POST',
        headers,
        body: JSON.stringify({
          topic: sensorConfigData.topic,
          clientId: sensorConfigData.clientId,
          username: sensorConfigData.username,
          enabled: sensorConfigData.enabled,
          location: sensorConfigData.location,
        })
      });
      if(!res.ok){ const body = await res.json().catch(()=>({})); alert('Configure failed: '+(body.error||res.statusText)); return; }
      await fetchSensors();
      closeSensorModal();
      alert('Sensor configuration saved');
    }catch(e){ console.error(e); alert('Failed to save sensor configuration'); }
  }

  async function fetchLogs(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/logs/`,{headers});
      if(!res.ok) throw new Error('fail');
      const data = await res.json();
      setActivityLogs(data.activity||[]);
      setErrorLogs(data.errors||[]);
    }catch(e){console.error(e)}
  }

  async function clearLogs(type: 'activity' | 'errors' | 'all'){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/logs/`, {
        method:'POST',
        headers,
        body: JSON.stringify({ action: 'clear', type })
      });
      if(!res.ok){
        const body = await res.json().catch(()=>({}));
        alert('Clear logs failed: ' + (body.error || res.statusText));
        return;
      }
      await fetchLogs();
      alert('Logs cleared');
    }catch(e){
      console.error(e);
      alert('Failed to clear logs');
    }
  }

  async function fetchSettings(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/settings/`,{headers});
      if(!res.ok) throw new Error('fail');
      const data = await res.json();
      const map = {} as Record<string,string>;
      data.forEach((it:any)=> map[it.key]=it.value);
      if(map['threshold_krl']) setThresholdKRL(map['threshold_krl']);
      if(map['threshold_kai']) setThresholdKAI(map['threshold_kai']);
      if(map['telegram_bot_token']) setTelegramBotToken(map['telegram_bot_token']);
      if(map['telegram_chat_id']) setTelegramChatId(map['telegram_chat_id']);
    }catch(e){console.error(e)}
  }

  async function saveSettings(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/api/monitoring/admin/settings/`,{method:'POST',headers,body:JSON.stringify({key:'threshold_krl', value:thresholdKRL})});
      await fetch(`${API_BASE}/api/monitoring/admin/settings/`,{method:'POST',headers,body:JSON.stringify({key:'threshold_kai', value:thresholdKAI})});
      alert('Settings saved');
    }catch(e){console.error(e)}
  }

  async function saveTelegramSettings(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${API_BASE}/api/monitoring/admin/settings/`,{method:'POST',headers,body:JSON.stringify({key:'telegram_bot_token', value:telegramBotToken})});
      await fetch(`${API_BASE}/api/monitoring/admin/settings/`,{method:'POST',headers,body:JSON.stringify({key:'telegram_chat_id', value:telegramChatId})});
      alert('Telegram settings saved');
    }catch(e){console.error(e); alert('Failed to save Telegram settings')}
  }

  async function sendTestTelegram(){
    try{
      const token = localStorage.getItem('fm_token');
      const headers:any = {'Content-Type':'application/json'};
      if(token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/monitoring/admin/test-telegram/`,{method:'POST', headers, body: JSON.stringify({message: 'This is a test alert from Admin Panel'})});
      if(!res.ok){ const body = await res.json().catch(()=>({})); alert('Send failed: '+(body.error||res.statusText)); return; }
      const body = await res.json().catch(()=>({}));
      alert('Telegram test sent');
    }catch(e){ console.error(e); alert('Failed to send test message'); }
  }

  return (
    <div className="space-y-6">
      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">Server Status</p>
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-5 h-5 ${serverOnline ? 'text-green-500' : 'text-red-500'}`} />
                  <span className="text-lg font-semibold text-gray-900">{serverOnline ? 'Online' : 'Offline'}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Auto refresh: every 5s</p>
              </div>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${serverOnline ? 'bg-green-100' : 'bg-red-100'}`}>
                <Server className={`w-6 h-6 ${serverOnline ? 'text-green-600' : 'text-red-600'}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">MQTT Connection</p>
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-5 h-5 ${mqttConnected ? 'text-green-500' : 'text-red-500'}`} />
                  <span className="text-lg font-semibold text-gray-900">{mqttConnected ? 'Connected' : 'Disconnected'}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Last ping: {formatLastPing()}</p>
              </div>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${mqttConnected ? 'bg-blue-100' : 'bg-red-100'}`}>
                <Radio className={`w-6 h-6 ${mqttConnected ? 'text-blue-600' : 'text-red-600'}`} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 mb-1">Network Status</p>
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-5 h-5 ${networkStatus === 'Stable' ? 'text-green-500' : networkStatus === 'Warning' ? 'text-yellow-500' : networkStatus === 'Unstable' ? 'text-red-500' : 'text-gray-500'}`} />
                  <span className="text-lg font-semibold text-gray-900">{networkStatus}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Latency: {networkLatency !== null ? `${networkLatency}ms` : '-'}</p>
              </div>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${networkStatus === 'Stable' ? 'bg-green-100' : networkStatus === 'Warning' ? 'bg-yellow-100' : networkStatus === 'Unstable' ? 'bg-red-100' : 'bg-gray-100'}`}>
                <Wifi className={`w-6 h-6 ${networkStatus === 'Stable' ? 'text-green-600' : networkStatus === 'Warning' ? 'text-yellow-600' : networkStatus === 'Unstable' ? 'text-red-600' : 'text-gray-600'}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Section */}
      <Card className="border-0 shadow-md">
        <Tabs defaultValue="users" className="w-full">
          <CardHeader className="border-b">
            <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
              <TabsTrigger value="users" className="gap-2">
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline">User Management</span>
                <span className="sm:hidden">Users</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">System Settings</span>
                <span className="sm:hidden">Settings</span>
              </TabsTrigger>
              <TabsTrigger value="sensors" className="gap-2">
                <Radio className="w-4 h-4" />
                <span className="hidden sm:inline">Sensors</span>
                <span className="sm:hidden">Sensors</span>
              </TabsTrigger>
              <TabsTrigger value="logs" className="gap-2">
                <Activity className="w-4 h-4" />
                <span className="hidden sm:inline">Logs</span>
                <span className="sm:hidden">Logs</span>
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-6">
            {/* User Management Tab */}
            <TabsContent value="users" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">User List</h3>
                <Button onClick={() => addUser()} className="gap-2 bg-blue-600 hover:bg-blue-700">
                  <Plus className="w-4 h-4" />
                  Add User
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.role || 'User'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              (user.status || 'Active') === "Active"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-700 border-gray-200"
                            }
                          >
                            {user.status || 'Active'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1 text-emerald-700 hover:bg-emerald-50"
                              onClick={() => makeAdmin(user)}
                              disabled={user.role === 'admin'}
                            >
                              <CheckCircle className="w-3 h-3" />
                              {user.role === 'admin' ? 'Admin' : 'Make Admin'}
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1" onClick={() => editUser(user)}>
                              <Edit className="w-3 h-3" />
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" className="gap-1 text-red-600 hover:bg-red-50" onClick={() => deleteUser(user.id)}>
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* System Settings Tab */}
            <TabsContent value="settings" className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Water Level Thresholds</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                  <div className="space-y-2">
                    <Label htmlFor="thresholdKRL">KRL Warning Threshold (cm)</Label>
                    <Input
                      id="thresholdKRL"
                      type="number"
                      value={thresholdKRL}
                      onChange={(e) => setThresholdKRL(e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Current: 60 cm</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thresholdKAI">KAI Warning Threshold (cm)</Label>
                    <Input
                      id="thresholdKAI"
                      type="number"
                      value={thresholdKAI}
                      onChange={(e) => setThresholdKAI(e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Current: 70 cm</p>
                  </div>
                </div>
                <Button onClick={() => saveSettings()} className="mt-4 bg-blue-600 hover:bg-blue-700">
                  Save Settings
                </Button>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Alert Configuration</h3>
                <div className="space-y-4 max-w-2xl">
                  <div className="p-4 border rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">Telegram Alerts</p>
                      <p className="text-sm text-gray-500">Configure Telegram bot token and chat id for alert delivery</p>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4">
                      <div>
                        <Label>Bot Token</Label>
                        <Input value={telegramBotToken} onChange={(e:any)=>setTelegramBotToken(e.target.value)} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
                      </div>
                      <div>
                        <Label>Chat ID</Label>
                        <Input value={telegramChatId} onChange={(e:any)=>setTelegramChatId(e.target.value)} placeholder="-1001234567890 or 123456789" />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => sendTestTelegram()} disabled={!telegramBotToken || !telegramChatId}>Send test message</Button>
                        <Button onClick={() => saveTelegramSettings()} className="bg-blue-600 hover:bg-blue-700">Save Telegram Settings</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Sensors Tab */}
            <TabsContent value="sensors" className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">Sensor Configuration</h3>
                <Button
                  className="gap-2 bg-blue-600 hover:bg-blue-700"
                  onClick={() => openSensorModal({ topic: 'RAINSENSORANCOL', clientId: 'mqttx_0d0ab77a', username: 'CAPSTONE', location: 'Manggarai', status: 'Online' }, 'add')}
                >
                  <Plus className="w-4 h-4" />
                  Add Sensor
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sensor Name</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Username</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Calibration</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sensors.map((sensor, idx) => (
                      <TableRow key={sensor.topic + '_' + sensor.location + '_' + idx}>
                        <TableCell className="font-medium">{sensor.topic}</TableCell>
                        <TableCell>{sensor.clientId || '-'}</TableCell>
                        <TableCell>{sensor.username || '-'}</TableCell>
                        <TableCell>{sensor.location}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              sensor.status === "Online"
                                ? "bg-green-100 text-green-700 border-green-200"
                                : "bg-red-100 text-red-700 border-red-200"
                            }
                          >
                            {sensor.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{sensor.lastCalibration || '-'}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleCalibrateSensor(sensor)}>
                              Calibrate
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openSensorModal(sensor)}>
                              Configure
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs" className="space-y-6">
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => fetchLogs()}>Refresh Logs</Button>
                <Button variant="outline" size="sm" onClick={() => clearLogs('activity')}>Clear Activity</Button>
                <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => clearLogs('errors')}>Clear Errors</Button>
              </div>
              {/* Activity Logs */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Logs</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityLogs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="font-medium">{log.user}</TableCell>
                          <TableCell>{log.action}</TableCell>
                          <TableCell className="text-gray-500">{log.timestamp}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Error Logs */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Error Logs</h3>
                <div className="space-y-3">
                  {errorLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-4 rounded-lg border-l-4 ${
                        log.severity === "High"
                          ? "bg-red-50 border-red-500"
                          : log.severity === "Medium"
                          ? "bg-yellow-50 border-yellow-500"
                          : "bg-blue-50 border-blue-500"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <AlertCircle
                            className={`w-5 h-5 mt-0.5 ${
                              log.severity === "High"
                                ? "text-red-600"
                                : log.severity === "Medium"
                                ? "text-yellow-600"
                                : "text-blue-600"
                            }`}
                          />
                          <div>
                            <p className="font-medium text-gray-900">{log.error}</p>
                            <p className="text-sm text-gray-500 mt-1">{log.timestamp}</p>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            log.severity === "High"
                              ? "bg-red-100 text-red-700 border-red-200"
                              : log.severity === "Medium"
                              ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                              : "bg-blue-100 text-blue-700 border-blue-200"
                          }
                        >
                          {log.severity}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
      {showUserModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black opacity-40" onClick={closeUserModal} />
          <div className="bg-white rounded-lg shadow-lg z-60 w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{userModalMode === 'add' ? 'Add User' : 'Edit User'}</h3>
            <div className="space-y-3">
              <div>
                <Label>Full name</Label>
                <Input value={userModalData.name} onChange={(e:any)=>setUserModalData({...userModalData, name: e.target.value})} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={userModalData.email} onChange={(e:any)=>setUserModalData({...userModalData, email: e.target.value})} />
                <p className="text-xs text-gray-500 mt-1">Email must end with @kai.id</p>
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={userModalData.password} onChange={(e:any)=>setUserModalData({...userModalData, password: e.target.value})} placeholder={userModalMode === 'edit' ? 'Leave blank to keep current password' : ''} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={closeUserModal}>Cancel</Button>
              <Button onClick={handleUserModalSave}>{userModalMode === 'add' ? 'Create' : 'Save'}</Button>
            </div>
          </div>
        </div>
      )}
      {showSensorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black opacity-40" onClick={closeSensorModal} />
          <div className="bg-white rounded-lg shadow-lg z-60 w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">{sensorModalMode === 'add' ? 'Add Sensor' : 'Configure Sensor'}</h3>
            <div className="space-y-3">
              <div>
                <Label>Topic</Label>
                <Input
                  value={sensorConfigData.topic}
                  onChange={(e:any) => setSensorConfigData({ ...sensorConfigData, topic: e.target.value.trimStart() })}
                  placeholder="CUSTOMSENSOR01"
                  disabled={sensorModalMode === 'edit'}
                />
                <p className="text-xs text-gray-500 mt-1">Gunakan topic MQTT yang sama dengan yang dikirim dari MQTTX, misalnya RAINSENSORANCOL.</p>
              </div>
              <div>
                <Label>Client ID</Label>
                <Input
                  value={sensorConfigData.clientId}
                  onChange={(e:any) => setSensorConfigData({ ...sensorConfigData, clientId: e.target.value.trimStart() })}
                  placeholder="mqttx_0d0ab77a"
                />
              </div>
              <div>
                <Label>Username</Label>
                <Input
                  value={sensorConfigData.username}
                  onChange={(e:any) => setSensorConfigData({ ...sensorConfigData, username: e.target.value.trimStart() })}
                  placeholder="CAPSTONE"
                />
                <p className="text-xs text-gray-500 mt-1">Untuk MQTTX, isi sesuai broker yang dipakai.</p>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={sensorConfigData.enabled ? 'enabled' : 'disabled'} onValueChange={(value) => setSensorConfigData({ ...sensorConfigData, enabled: value === 'enabled' })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={sensorConfigData.location}
                  onChange={(e:any) => setSensorConfigData({ ...sensorConfigData, location: e.target.value })}
                  placeholder="Manggarai"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={closeSensorModal}>Cancel</Button>
              <Button onClick={saveSensorConfiguration}>{sensorModalMode === 'add' ? 'Register' : 'Save'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Note: modal markup is inserted inside component return above; keep file consistent
