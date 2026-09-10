
class Component extends DCLogic {
  constructor(props){
    super(props);
    this.state = this.getInitialState();
  }

  getInitialState(){
    return {
      loggedIn: false, loginEmail: '', loginPassword: '', loginNoteText: '',
      role: 'home', screen: 'home', setupTab: 'parties',
      activeClient: 'meridian',
      activeService: 'civil',
      personaMenuOpen: false,
      searchQuery: '',
      activeDiscipline: 'Civil',
      selectedInstanceIdx: 0,
      vaultRevisionAlert: false,
      engagementBrandModeByClient: { meridian: 'jags-led', northgate: 'jags-led' },
      activeScenario: 'A',
      delRioStep: 1,
      democontrolPos: 'tr',
      democontrolCollapsed: false,
      aiGenStep: 'attach',
      aiGenDocsAttached: [true, false],
      aiGenProgress: 0,
      notifications: [],
      notifPanelOpen: false,
      engagementModeByClient: { meridian:'managed', northgate:'managed' },
      itpExpanded: true,
      itpPackages: [
        { key:'flooring', name:'Flooring & Screed ITP', discipline:'Civil', itpNumber:'MER-JAGS-ITP-101', status:'not_started', progress:0, attachedDocs:[], everBuilt:false, revision:1, subcontractorOrg:'Apex Flooring Solutions', subcontractorContact:'Rosa Klein', sign:{contractor:false,subcontractor:false,tpi:false,jags:false,client:false} },
        { key:'ceiling', name:'Ceiling & Partitions ITP', discipline:'Civil', itpNumber:'MER-JAGS-ITP-102', status:'not_started', progress:0, attachedDocs:[], everBuilt:false, revision:1, subcontractorOrg:'SkyLine Ceilings Ltd.', subcontractorContact:'Tomás Reyes', sign:{contractor:false,subcontractor:false,tpi:false,jags:false,client:false} },
        { key:'painting', name:'Painting & Finishes ITP', discipline:'Civil', itpNumber:'MER-JAGS-ITP-103', status:'not_started', progress:0, attachedDocs:[], everBuilt:false, revision:1, subcontractorOrg:'ColorCraft Painters', subcontractorContact:'Priya Nair', sign:{contractor:false,subcontractor:false,tpi:false,jags:false,client:false} },
        { key:'electrical', name:'Electrical Fit-out ITP', discipline:'Electrical', itpNumber:'MER-JAGS-ITP-104', status:'not_started', progress:0, attachedDocs:[], everBuilt:false, revision:1, subcontractorOrg:'Voltway Electrical Contractors', subcontractorContact:'Sam Osei', sign:{contractor:false,subcontractor:false,tpi:false,jags:false,client:false} }
      ],
      activeItpPackageIdx: 0,
      expandedPackageIdx: null,
      reportDocType: 'itp',
      inspectorTab: 'all',
      vaultActiveFolder: '02 Specifications',
      vaultSelectedDocIdx: 0,
      checklistBuilderExpandedIdx: 2,
      checklistBuilderTemplateType: 'checklist',
      startWorkMode: 'itp',
      itpBuilderAiBannerDismissed: false,
      itpBuilderExpandedRowIdx: null,
      itpBuilderSearch: '',
      assignmentTypeTab: 'FAT',
      assignmentDetailTab: 'measurements',
      clientWitnessName: '',
      ncrRegisterSearch: '', ncrRegisterProjectFilter: 'all', ncrRegisterTypeFilter: 'all', ncrRegisterStatusFilter: 'all',
      obsRegisterSearch: '', obsRegisterProjectFilter: 'all', obsRegisterTypeFilter: 'all', obsRegisterStatusFilter: 'all',
      itpRegisterSearch: '',
      itpRegisterProjectFilter: 'all',
      itpRegisterDisciplineFilter: 'all',
      itpRegisterStatusFilter: 'all',
      itpRegisterOpenMenuIdx: null,
      checklistBuilderPreviewMode: 'tablet',
      checklistBuilderItems: [
        { n:'01', text:'Cable route matches latest approved drawing', type:'Yes / No / N-A', mandatory:true },
        { n:'02', text:'Support spacing complies with specification', type:'Yes / No / N-A', mandatory:true },
        { n:'03', text:'Minimum bend radius is maintained', type:'Yes / No / N-A', mandatory:true, allowMeasured:true, unit:'mm', photoOnNo:true, helper:'Measure the minimum bend radius at the most critical point.' },
        { n:'04', text:'Power and control cables are segregated', type:'Yes / No / N-A', mandatory:true },
        { n:'05', text:'Cable identification is installed at both ends', type:'Yes / No / N-A', mandatory:true },
        { n:'06', text:'Cable tray penetrations are sealed and protected', type:'Yes / No / N-A', mandatory:false }
      ],
      handoverAcksByClient: {},
      partyActiveByClient: {
        meridian: { contractor:true, subcontractor:true, tpi:true, jags:true, client:true },
        northgate: { contractor:true, subcontractor:true, tpi:true, jags:true, client:true }
      },
      assignments: [
        {
          key:'fat-pump', number:'MER-JAGS-FAT-001', type:'FAT', title:'Firewater Pump Skid — Factory Acceptance Test',
          equipment:'Firewater Pump Skid FP-02', location:'Vendor Workshop, Houston TX', standardRef:'API 610 / Client Spec ES-004',
          manufacturer:'Apex Industrial', model:'FWP-950X', serialTag:'SN-22841 / FP-02',
          attachedChecklist:{ id:'FAT-CHK-PUMP-001', itemCount:18, version:2 },
          status:'not_started',
          measurements:[
            { item:'Rated flow at duty point', criteria:'950 USgpm ± 3%', result:'', resultWhenRecorded:'962 USgpm', status:'pending', pass:true },
            { item:'Rated head at duty point', criteria:'210 m ± 3%', result:'', resultWhenRecorded:'213 m', status:'pending', pass:true },
            { item:'NPSH margin', criteria:'≥ 1.0 m above required NPSH', result:'', resultWhenRecorded:'1.4 m margin', status:'pending', pass:true },
            { item:'Vibration (overall)', criteria:'≤ 4.5 mm/s per ISO 10816', result:'', resultWhenRecorded:'2.1 mm/s', status:'pending', pass:true }
          ],
          punchList:[
            { text:'Touch-up paint on baseplate corner', open:true },
            { text:'Confirm coupling guard fastener torque', open:false }
          ],
          photos:[
            { name:'FP-02_overall_01.jpg', caption:'Overall view — skid assembly', color:'#8a95a6' },
            { name:'FP-02_nameplate.jpg', caption:'Nameplate / serial', color:'#b5895a' },
            { name:'FP-02_suction_conn.jpg', caption:'Suction connection detail', color:'#6f8f7a' },
            { name:'FP-02_discharge_conn.jpg', caption:'Discharge connection detail', color:'#7a8a9a' },
            { name:'FP-02_coupling_guard.jpg', caption:'Coupling guard', color:'#a67c8a' },
            { name:'FP-02_baseplate.jpg', caption:'Baseplate / grouting', color:'#9a8f6f' }
          ],
          sign:{ contractor:false, tpi:false, jags:false, client:false },
          signOrgs:{ contractor:'Trident Marine Construction', tpi:'Apex Testing Labs', jags:'Jags Assurance', client:'Meridian Energy' }
        },
        {
          key:'insp-flange', number:'MER-JAGS-FAT-002', type:'Standalone Inspection', title:'Flange Bolt Torque Verification',
          equipment:'Pipe Rack Section 14 — Flanged Joints', location:'Site — Pipe Rack Sec. 14', standardRef:'ASME B31.3 / Client Bolting Spec',
          manufacturer:'Northgate Fabrication', model:'FL-014-STD', serialTag:'TAG-FL014 / Sec-14',
          attachedChecklist:{ id:'INSP-CHK-FLANGE-002', itemCount:9, version:1 },
          status:'not_started',
          measurements:[
            { item:'Bolt torque — Joint FL-014-01', criteria:'450 N·m ± 5%', result:'', resultWhenRecorded:'448 N·m', status:'pending', pass:true },
            { item:'Bolt torque — Joint FL-014-02', criteria:'450 N·m ± 5%', result:'', resultWhenRecorded:'455 N·m', status:'pending', pass:true },
            { item:'Gasket seating visual', criteria:'No visible extrusion/misalignment', result:'', resultWhenRecorded:'No defects observed', status:'pending', pass:true }
          ],
          punchList:[],
          photos:[
            { name:'FL-014_overview.jpg', caption:'Overall view — pipe rack Sec. 14', color:'#8a95a6' },
            { name:'FL-014-01_flange.jpg', caption:'Flange joint FL-014-01 close-up', color:'#6f8f7a' },
            { name:'FL-014-02_flange.jpg', caption:'Flange joint FL-014-02 close-up', color:'#b5895a' },
            { name:'FL-014_gasket.jpg', caption:'Gasket seating detail', color:'#7a8a9a' }
          ],
          sign:{ contractor:false, jags:false, client:false },
          signOrgs:{ contractor:'Trident Marine Construction', jags:'Jags Assurance', client:'Meridian Energy' }
        }
      ],
      activeAssignmentIdx: 0,
      punchListItems: [
        { text:'Touch-up paint on Foundation F-001 formwork edge', raisedBy:'BayShore Rebar Co.', open:true },
        { text:'Confirm rebar cover tolerance on Column C-04', raisedBy:'Trident Marine Construction', open:true },
        { text:'Housekeeping — clear debris near Vault access route', raisedBy:'Jags Inspector', open:false }
      ],
      conditionalHandoverUsed: false,
      conditionalHandoverReason: '',
      sign: { contractor:false, subcontractor:false, tpi:false, jags:'Day 1, 9:02 AM', client:false },
      northgateSign: { contractor:false, subcontractor:false, tpi:'Day 1, 10:15 AM', jags:'Day 1, 9:40 AM', client:false },
      fieldAnswers: [
        { status:'unset', comment:'' }, { status:'unset', comment:'' }, { status:'unset', comment:'' },
        { status:'unset', comment:'' }, { status:'unset', comment:'' }
      ],
      fieldPhotos: 0,
      fieldSigned: false,
      subSubmitted: false,
      contractorApproved: false,
      tpiUploaded: false,
      witness: 'pending',
      witnessWaiveOpen: false,
      witnessReason: '',
      result: 'none',
      ncr: { status: 'none', severity: null, response: '', containment: false, rootCause: false },
      observation: { status: 'none' },
      handover: false,
      csaVerified: false, mepVerified: false, holdReleased: false,
      clientAddedParties: [], clientUploadedDocs: [],
      uploadCategory: '02 Specifications',
      viewingAsAddedPartyIdx: null,
      log: []
    };
  }

  go(role, screen){ return () => this.setState({ role, screen }); }
  setupGo(tab){ return () => this.setState({ setupTab: tab }); }
  resetDemo(){ return () => this.setState(this.getInitialState()); }
  openAiItpGen(){
    return () => this.setState({ role:'admin', screen:'aiitp', aiGenStep:'attach', aiGenProgress:0, aiGenDocsAttached:[true,false] });
  }
  toggleAiGenDoc(idx){
    return () => {
      const arr = this.state.aiGenDocsAttached.slice();
      arr[idx] = !arr[idx];
      this.setState({ aiGenDocsAttached: arr });
    };
  }
  startAiGeneration(){
    return () => {
      this.setState({ aiGenStep:'processing', aiGenProgress:0 });
      const tick = (n) => {
        setTimeout(() => {
          if (n >= 4) { this.setState({ aiGenStep:'review' }); return; }
          this.setState({ aiGenProgress: n });
          tick(n+1);
        }, 700);
      };
      tick(1);
    };
  }
  acceptAiItpDraft(){
    return () => this.setState({ role:'admin', screen:'itp', log: this.appendLog('AI drafted ITP sections from the attached specification & drawing; reviewed and saved by Priya Desai.') });
  }
  openItpPackage(idx){
    return () => {
      const pkgs = this.state.itpPackages.slice();
      pkgs[idx] = { ...pkgs[idx], status:'attach', progress:0 };
      this.setState({ itpPackages: pkgs, activeItpPackageIdx: idx, screen:'packageGen' });
    };
  }
  toggleItpPackageDoc(docName){
    return () => {
      const idx = this.state.activeItpPackageIdx;
      const pkgs = this.state.itpPackages.slice();
      const pkg = pkgs[idx];
      const set = new Set(pkg.attachedDocs || []);
      if (set.has(docName)) set.delete(docName); else set.add(docName);
      pkgs[idx] = { ...pkg, attachedDocs: [...set] };
      this.setState({ itpPackages: pkgs });
    };
  }
  startItpPackageGeneration(){
    return () => {
      const idx = this.state.activeItpPackageIdx;
      const setPkgStatus = (patch) => {
        const pkgs = this.state.itpPackages.slice();
        pkgs[idx] = { ...pkgs[idx], ...patch };
        this.setState({ itpPackages: pkgs });
      };
      setPkgStatus({ status:'processing', progress:0 });
      const tick = (n) => {
        setTimeout(() => {
          if (n >= 4) { setPkgStatus({ status:'review' }); return; }
          setPkgStatus({ progress: n });
          tick(n+1);
        }, 700);
      };
      tick(1);
    };
  }
  acceptItpPackageDraft(){
    return () => {
      const idx = this.state.activeItpPackageIdx;
      const pkgs = this.state.itpPackages.slice();
      const pkg = pkgs[idx];
      const isRevision = pkg.everBuilt;
      const nextRevision = isRevision ? (pkg.revision || 1) + 1 : (pkg.revision || 1);
      const nextSign = isRevision ? { contractor:false, subcontractor:false, tpi:false, jags:false, client:false } : pkg.sign;
      pkgs[idx] = { ...pkg, status:'built', everBuilt:true, revision: nextRevision, sign: nextSign };
      const reviewer = this.state.role==='client' ? "Meridian Energy's own team" : 'Priya Desai';
      const logText = isRevision
        ? pkg.itpNumber + ' (' + pkg.name + ') redrafted as Rev ' + nextRevision + ' with updated documents by ' + reviewer + ' — all sign-offs reset, every party must re-approve.'
        : 'AI drafted ' + pkg.name + ' (' + pkg.itpNumber + ') — reviewed and saved by ' + reviewer + '. Assigned parties can now sign.';
      const notifText = isRevision
        ? pkg.itpNumber + ' (' + pkg.name + ') redrafted as Rev ' + nextRevision + ' — re-approval required.'
        : pkg.itpNumber + ' (' + pkg.name + ') drafted — assigned parties can now sign.';
      this.setState({ itpPackages: pkgs, screen:'packages',
        log: this.appendLog(logText),
        notifications: [...this.state.notifications, this.notify('approval', notifText, 'admin', 'packages')]
      });
    };
  }
  togglePackageExpand(idx){
    return () => this.setState({ expandedPackageIdx: this.state.expandedPackageIdx === idx ? null : idx });
  }
  signPackageParty(idx, key, party, org, requiredKeys){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const pkgs = this.state.itpPackages.slice();
      const pkg = pkgs[idx];
      const sign = { ...pkg.sign, [key]: t };
      const keys = requiredKeys || Object.keys(sign);
      const allSigned = keys.every((k) => sign[k]);
      pkgs[idx] = { ...pkg, sign, status: allSigned ? 'approved' : pkg.status };
      this.setState({ itpPackages: pkgs, log: this.appendLog(org + ' signed ' + pkg.itpNumber + ' (' + pkg.name + ').') });
    };
  }
  closePunchItem(idx){
    return () => {
      const items = this.state.punchListItems.slice();
      const item = items[idx];
      items[idx] = { ...item, open:false };
      this.setState({ punchListItems: items, log: this.appendLog('Punch-list item closed: "' + item.text + '".') });
    };
  }
  generateConditionalHandover(){
    return () => {
      const reason = this.state.conditionalHandoverReason;
      this.setState({ handover:true, conditionalHandoverUsed:true, conditionalHandoverReason:'',
        log: this.appendLog('Handover Certificate MER-JAGS-HOC-001 generated under Conditional Handover — open punch items remain. Documented reason: "' + reason + '".'),
        notifications:[...this.state.notifications, this.notify('handover','Handover Certificate MER-JAGS-HOC-001 generated (Conditional) — open punch items remain, see documented reason.','client','databook')]
      });
    };
  }
  verifyDiscipline(field, label){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      this.setState({ [field]: t, log: this.appendLog(label + ' discipline verified Pre-Pour Inspection.') });
    };
  }
  releaseHoldPoint(){
    return () => this.setState({ holdReleased: true, log: this.appendLog('Jags Assurance released the Pre-Pour Inspection hold point.') });
  }
  addClientParty(){
    return () => {
      const n = this.state.clientAddedParties.length + 1;
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const jobRoles = ['Site Engineer','QA Manager','Safety Officer','Project Coordinator'];
      const jobRole = jobRoles[this.state.clientAddedParties.length % jobRoles.length];
      const orgNames = { meridian:'Meridian Energy', northgate:'Northgate Rail' };
      const orgName = orgNames[this.state.activeClient];
      const who = this.state.role === 'client' ? orgName + "'s own team" : 'Priya Desai (Jags Admin)';
      const entry = { role:'Vendor', jobRole, org:'New Vendor ' + n, chain:'Added by ' + who, contact:'TBC', email:'TBC', t, signed:null };
      this.setState({ clientAddedParties:[...this.state.clientAddedParties, entry], log: this.appendLog(who + ' added ' + entry.org + ' (' + jobRole + ') to the ' + orgName + ' project team.') });
    };
  }
  removeClientParty(idx){
    return () => {
      const arr = this.state.clientAddedParties.slice();
      const removed = arr[idx];
      arr.splice(idx, 1);
      this.setState({ clientAddedParties: arr, log: this.appendLog('Removed ' + removed.org + ' (' + removed.jobRole + ') from the project team.') });
    };
  }
  togglePartyActive(key){
    return () => {
      const ck = this.state.activeClient;
      const orgNames = { meridian:'Meridian Energy', northgate:'Northgate Rail' };
      const partyLabels = { contractor:'Contractor', subcontractor:'Subcontractor', tpi:'TPI / Lab', jags:'Jags Assurance', client:'Client' };
      const cur = this.state.partyActiveByClient[ck];
      const nextActive = !cur[key];
      const next = { ...cur, [key]: nextActive };
      this.setState({
        partyActiveByClient: { ...this.state.partyActiveByClient, [ck]: next },
        log: this.appendLog((nextActive ? 'Reactivated ' : 'Deactivated ') + partyLabels[key] + ' for ' + orgNames[ck] + ' — ' + (nextActive ? 'now required' : 'not required') + ' for ITP sign-off.')
      });
    };
  }
  viewAsAddedParty(idx){
    return () => this.setState({ viewingAsAddedPartyIdx: idx });
  }
  stopViewingAsAddedParty(){
    return () => this.setState({ viewingAsAddedPartyIdx: null });
  }
  setUploadCategory(cat){
    return () => this.setState({ uploadCategory: cat });
  }
  setReportDocType(t){
    return () => this.setState({ reportDocType: t });
  }
  setInspectorTab(t){
    return () => this.setState({ inspectorTab: t });
  }
  selectVaultFolder(name){
    return () => this.setState({ vaultActiveFolder: name, vaultSelectedDocIdx: 0 });
  }
  selectVaultDoc(idx){
    return () => this.setState({ vaultSelectedDocIdx: idx });
  }
  dismissItpAiBanner(){ return () => this.setState({ itpBuilderAiBannerDismissed: true }); }
  toggleItpBuilderRow(idx){ return () => this.setState({ itpBuilderExpandedRowIdx: this.state.itpBuilderExpandedRowIdx === idx ? null : idx }); }
  setItpBuilderSearch(){ return (e) => this.setState({ itpBuilderSearch: e.target.value }); }
  setAssignmentTypeTab(t){ return () => this.setState({ assignmentTypeTab: t }); }
  setAssignmentDetailTab(t){ return () => this.setState({ assignmentDetailTab: t }); }
  onClientWitnessName(){
    return (e) => this.setState({ clientWitnessName: e.target.value });
  }
  setNcrRegisterSearch(){
    return (e) => this.setState({ ncrRegisterSearch: e.target.value });
  }
  setNcrRegisterProjectFilter(){
    return (e) => this.setState({ ncrRegisterProjectFilter: e.target.value });
  }
  setNcrRegisterTypeFilter(){
    return (e) => this.setState({ ncrRegisterTypeFilter: e.target.value });
  }
  setNcrRegisterStatusFilter(){
    return (e) => this.setState({ ncrRegisterStatusFilter: e.target.value });
  }
  clearNcrRegisterFilters(){
    return () => this.setState({ ncrRegisterSearch:'', ncrRegisterProjectFilter:'all', ncrRegisterTypeFilter:'all', ncrRegisterStatusFilter:'all' });
  }
  setObsRegisterSearch(){
    return (e) => this.setState({ obsRegisterSearch: e.target.value });
  }
  setObsRegisterProjectFilter(){
    return (e) => this.setState({ obsRegisterProjectFilter: e.target.value });
  }
  setObsRegisterTypeFilter(){
    return (e) => this.setState({ obsRegisterTypeFilter: e.target.value });
  }
  setObsRegisterStatusFilter(){
    return (e) => this.setState({ obsRegisterStatusFilter: e.target.value });
  }
  clearObsRegisterFilters(){
    return () => this.setState({ obsRegisterSearch:'', obsRegisterProjectFilter:'all', obsRegisterTypeFilter:'all', obsRegisterStatusFilter:'all' });
  }
  setItpRegisterSearch(){
    return (e) => this.setState({ itpRegisterSearch: e.target.value });
  }
  setItpRegisterProjectFilter(){
    return (e) => this.setState({ itpRegisterProjectFilter: e.target.value });
  }
  setItpRegisterDisciplineFilter(){
    return (e) => this.setState({ itpRegisterDisciplineFilter: e.target.value });
  }
  setItpRegisterStatusFilter(){
    return (e) => this.setState({ itpRegisterStatusFilter: e.target.value });
  }
  clearItpRegisterFilters(){
    return () => this.setState({ itpRegisterSearch:'', itpRegisterProjectFilter:'all', itpRegisterDisciplineFilter:'all', itpRegisterStatusFilter:'all' });
  }
  toggleItpRegisterRowMenu(idx){
    return () => this.setState({ itpRegisterOpenMenuIdx: this.state.itpRegisterOpenMenuIdx === idx ? null : idx });
  }
  itpRegisterNoop(){
    return () => {};
  }
  toggleChecklistItemExpanded(idx){
    return () => this.setState({ checklistBuilderExpandedIdx: this.state.checklistBuilderExpandedIdx === idx ? null : idx });
  }
  toggleChecklistItemMandatory(idx){
    return () => {
      const items = this.state.checklistBuilderItems.map((it, i) => i === idx ? { ...it, mandatory: !it.mandatory } : it);
      this.setState({ checklistBuilderItems: items });
    };
  }
  setChecklistTemplateType(type){
    return () => this.setState({ checklistBuilderTemplateType: type });
  }
  selectStartWorkMode(mode){ return () => this.setState({ startWorkMode: mode }); }
  setChecklistPreviewMode(mode){
    return () => this.setState({ checklistBuilderPreviewMode: mode });
  }
  checklistBuilderNoop(){
    return () => {};
  }
  acknowledgeHandoverRow(key){
    return () => this.setState({ handoverAcksByClient: { ...this.state.handoverAcksByClient, [key]: true }, log: this.appendLog('Handover row ' + key + ' acknowledged by client.') });
  }
  openAssignment(idx){
    return () => {
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      if (a.status === 'not_started') arr[idx] = { ...a, status: 'in_progress' };
      this.setState({ assignments: arr, activeAssignmentIdx: idx, screen: 'assignmentDetail' });
    };
  }
  goAssignments(){
    return () => this.setState({ screen: 'assignments' });
  }
  recordMeasurement(mIdx){
    return () => {
      const idx = this.state.activeAssignmentIdx;
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      const measurements = a.measurements.slice();
      const m = measurements[mIdx];
      measurements[mIdx] = { ...m, result: m.resultWhenRecorded, status: 'recorded' };
      arr[idx] = { ...a, measurements };
      this.setState({ assignments: arr, log: this.appendLog('Recorded "' + m.item + '" on ' + a.number + ' — ' + m.resultWhenRecorded + '.') });
    };
  }
  closeAssignmentPunch(pIdx){
    return () => {
      const idx = this.state.activeAssignmentIdx;
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      const punchList = a.punchList.slice();
      const p = punchList[pIdx];
      punchList[pIdx] = { ...p, open: false };
      arr[idx] = { ...a, punchList };
      this.setState({ assignments: arr, log: this.appendLog('Punch-list item closed on ' + a.number + ': "' + p.text + '".') });
    };
  }
  signAssignmentParty(party){
    return () => {
      const idx = this.state.activeAssignmentIdx;
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      const sign = { ...a.sign, [party]: true };
      arr[idx] = { ...a, sign };
      this.setState({ assignments: arr, log: this.appendLog(a.signOrgs[party] + ' signed ' + a.number + ' (' + a.title + ').') });
    };
  }
  signAssignmentPartyFor(idx, party){
    return () => {
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      const sign = { ...a.sign, [party]: true };
      arr[idx] = { ...a, sign };
      this.setState({ assignments: arr, log: this.appendLog(a.signOrgs[party] + ' signed ' + a.number + ' (' + a.title + ') from the Approvals Centre.') });
    };
  }
  generateFatReport(){
    return () => {
      const idx = this.state.activeAssignmentIdx;
      const arr = this.state.assignments.slice();
      const a = arr[idx];
      arr[idx] = { ...a, status: 'complete' };
      const docLabel = a.type === 'FAT' ? 'FAT Report' : 'Test Certificate';
      this.setState({ assignments: arr,
        log: this.appendLog(docLabel + ' ' + a.number + ' generated for ' + a.title + ' — all measurements recorded, punch-list clear, all parties signed.'),
        notifications: [...this.state.notifications, this.notify('handover', docLabel + ' ' + a.number + ' generated for ' + a.title + '.', 'client', 'assignments')]
      });
    };
  }
  signAddedParty(idx){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const arr = this.state.clientAddedParties.slice();
      const org = arr[idx].org;
      arr[idx] = { ...arr[idx], signed: t };
      this.setState({ clientAddedParties: arr, log: this.appendLog(org + ' signed ITP-001.'),
        notifications: [...this.state.notifications, this.notify('approval', org + ' (client-added party) signed the ITP.', 'client', 'setup')] });
    };
  }
  uploadClientDoc(){
    return () => {
      const n = this.state.clientUploadedDocs.length + 1;
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const category = this.state.uploadCategory;
      const entry = { name:'Client-Uploaded-Doc-' + n + '.pdf', by:'Naveen Iyer', t, category };
      this.setState({ clientUploadedDocs:[...this.state.clientUploadedDocs, entry], log: this.appendLog('Meridian Energy uploaded a document to "' + category + '" in their own vault (self-service).') });
    };
  }
  setEngagementMode(mode){
    return () => {
      const orgNames = { meridian:'Meridian Energy', northgate:'Northgate Rail' };
      const activeClient = this.state.activeClient;
      const next = { ...this.state.engagementModeByClient, [activeClient]: mode };
      this.setState({ engagementModeByClient: next, log: this.appendLog('Service Delivery Mode set to ' + (mode==='managed' ? 'Jags-Managed' : 'Client Self-Service') + ' for ' + orgNames[activeClient] + '.') });
    };
  }
  acceptItpAsClient(){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      this.setState({ sign: { ...this.state.sign, client: t }, log: this.appendLog('Meridian Energy accepted MER-JAGS-ITP-001 from their own portal.') });
    };
  }
  openClient(clientKey){ return () => this.setState({ activeClient: clientKey, role:'admin', screen:'setup' }); }
  openClientWorkspace(clientKey){ return () => this.setState({ activeClient: clientKey, role:'admin', screen:'clientWorkspace' }); }
  openProjectControl(){ return () => this.setState({ role:'admin', screen:'projectControl' }); }
  togglePersonaMenu(){ return () => this.setState({ personaMenuOpen: !this.state.personaMenuOpen }); }
  selectPersona(roleKey){ return () => this.setState({ role: roleKey, screen: this._defaultScreen(roleKey), personaMenuOpen: false }); }
  openMyWork(){ return () => this.setState({ role:'admin', screen:'myWork' }); }
  noopClick(){ return () => {}; }
  cycleDemoControlPos(){
    return () => {
      const order = ['tr','br','bl','tl'];
      const next = order[(order.indexOf(this.state.democontrolPos) + 1) % order.length];
      this.setState({ democontrolPos: next });
    };
  }
  toggleDemoControlCollapsed(){ return () => this.setState({ democontrolCollapsed: !this.state.democontrolCollapsed }); }
  advanceOnboarding(){
    return () => {
      const stepDefs = ['Project Details','Team & Parties','Disciplines','Documents','Numbering','ITP Approval Chain','Ready for Execution'];
      const completedLabel = stepDefs[this.state.delRioStep - 1] || 'Onboarding';
      this.setState({ delRioStep: Math.min(this.state.delRioStep + 1, 8), log: this.appendLog('"' + completedLabel + '" completed for Del Rio Petrochem onboarding.') });
    };
  }
  openDiscipline(name){ return () => this.setState({ role:'admin', screen:'discipline', activeDiscipline: name }); }
  simulateRevisionUpdate(){ return () => this.setState({ vaultRevisionAlert: true, log: this.appendLog('DRG-CIV-001 Rev 4 uploaded to the vault by Priya Desai.') }); }
  resolveRevisionAlert(){ return () => this.setState({ vaultRevisionAlert: false, log: this.appendLog('Jags Admin updated all linked records to reference DRG-CIV-001 Rev 4.') }); }
  setBrandMode(mode){
    return () => {
      const orgNames = { meridian:'Meridian Energy', northgate:'Northgate Rail' };
      const activeClient = this.state.activeClient;
      const next = { ...this.state.engagementBrandModeByClient, [activeClient]: mode };
      const modeLabels = { 'jags-led':'Jags-led', 'co-branded':'Co-branded', 'white-label':'White-label' };
      this.setState({ engagementBrandModeByClient: next, log: this.appendLog('Engagement Mode (branding) set to ' + modeLabels[mode] + ' for ' + orgNames[activeClient] + '.') });
    };
  }
  runScenario(key){
    return () => {
      const base = this.getInitialState();
      const t = (m) => 'Day 1, ' + m;
      let patch = {};
      let landing = { role:'home', screen:'home' };
      if (key==='B') {
        patch = {
          subSubmitted:true, contractorApproved:true, tpiUploaded:true, witness:'attended',
          fieldAnswers: [
            { status:'yes', comment:'' }, { status:'no', comment:'Cover blocks exceed 900mm max spacing' },
            { status:'yes', comment:'' }, { status:'yes', comment:'' }, { status:'yes', comment:'' }
          ],
          fieldPhotos:2, fieldSigned:true,
          result:'fail', ncr:{ status:'open', severity:'major', response:'', description:'Cover block spacing exceeds 900mm max per DRG-CIV-001 Rev 3.', containment:false, rootCause:false },
          log:[{ t:'Day 1', text:'Scenario B loaded — failed inspection, Major NCR open on Activity 2.1.' }]
        };
        landing = { role:'inspector', screen:'ncr' };
      } else if (key==='C') {
        patch = { csaVerified: t('11:00 AM'), log:[{ t:'Day 1', text:'Scenario C loaded — CSA verified, MEP still outstanding, Hold Point locked.' }] };
        landing = { role:'admin', screen:'holdpoint' };
      } else if (key==='D') {
        patch = { engagementModeByClient: { meridian:'selfservice', northgate:'managed' }, log:[{ t:'Day 1', text:'Scenario D loaded — Meridian Energy set to Client Self-Service (client-led).' }] };
        landing = { role:'client', screen:'setup' };
      } else if (key==='E') {
        patch = {
          subSubmitted:true, contractorApproved:true, tpiUploaded:true, witness:'attended',
          fieldAnswers: [0,1,2,3,4].map(() => ({ status:'yes', comment:'' })),
          fieldPhotos:3, fieldSigned:true,
          sign: { contractor:t('10:00 AM'), subcontractor:t('10:05 AM'), tpi:t('10:10 AM'), jags:t('9:02 AM'), client:t('10:15 AM') },
          result:'pass', ncr:{ status:'none', severity:null, response:'', containment:false, rootCause:false },
          csaVerified:t('11:00 AM'), mepVerified:t('11:05 AM'), holdReleased:true,
          handover:true,
          log:[{ t:'Day 1', text:'Scenario E loaded — full pass, Data Book 100%, Handover issued to Meridian Energy.' }]
        };
        landing = { role:'client', screen:'databook' };
      } else if (key==='F') {
        patch = { vaultRevisionAlert:true, log:[{ t:'Day 1', text:'Scenario F loaded — DRG-CIV-001 Rev 4 uploaded, revision impact alert raised.' }] };
        landing = { role:'admin', screen:'vault' };
      } else {
        patch = { log:[{ t:'Day 1', text:'Scenario A loaded — default Jags-led normal inspection flow.' }] };
        landing = { role:'home', screen:'home' };
      }
      this.setState({ ...base, ...patch, loggedIn:true, activeScenario:key, ...landing });
    };
  }
  openInstance(idx){ return () => this.setState({ role:'admin', screen:'instanceDetail', selectedInstanceIdx: idx }); }
  onSearchInput(){ return (e) => this.setState({ searchQuery: e.target.value }); }
  clearSearch(){ return () => this.setState({ searchQuery: '' }); }
  loginAs(roleKey){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const landingRole = roleKey==='admin' ? 'home' : roleKey;
      const landingScreen = roleKey==='admin' ? 'home' : this._defaultScreen(roleKey);
      const patch = { loggedIn:true, role: landingRole, screen: landingScreen, log: this.appendLog('Signed in at ' + t + '.') };
      if (roleKey==='client') patch.engagementModeByClient = { ...this.state.engagementModeByClient, meridian:'managed' };
      this.setState(patch);
    };
  }
  loginAsSelfServiceClient(){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      this.setState({
        loggedIn:true, role:'client', screen:'setup',
        engagementModeByClient: { ...this.state.engagementModeByClient, meridian:'selfservice' },
        log: this.appendLog('Signed in at ' + t + ' (Client Self-Service).')
      });
    };
  }
  signPartyGeneric(stateField, key, party, org){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const next = { ...this.state[stateField], [key]: t };
      this.setState({ [stateField]: next, log: this.appendLog(org + ' signed as ' + party + '.') });
    };
  }
  appendLog(text){
    const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    return [...this.state.log, { t, text }];
  }
  notify(category, text, role, screen){
    const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    return { id: 'n' + Date.now() + '_' + Math.random().toString(36).slice(2,7), category, text, role, screen, status:'unread', t };
  }
  toggleNotifPanel(){
    return () => this.setState({ notifPanelOpen: !this.state.notifPanelOpen });
  }
  openNotification(id, role, screen){
    return () => {
      const notifications = this.state.notifications.map(n => n.id===id ? { ...n, status:'read' } : n);
      this.setState({ notifications, notifPanelOpen:false, role, screen });
    };
  }
  setFieldAnswer(i, status){
    const arr = this.state.fieldAnswers.slice();
    arr[i] = { ...arr[i], status };
    this.setState({ fieldAnswers: arr });
  }
  setFieldComment(i, comment){
    const arr = this.state.fieldAnswers.slice();
    arr[i] = { ...arr[i], comment };
    this.setState({ fieldAnswers: arr });
  }
  signParty(key, party){
    return () => {
      const t = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      const sign = { ...this.state.sign, [key]: t };
      this.setState({ sign, log: this.appendLog(party + ' signed ITP-001.') });
    };
  }

  render_() {}

  renderVals() {
    const st = this.state;
    const go = (r,s) => this.go(r,s);

    const navMap = {
      admin: [['dash','Dashboard'],['startWork','Start Work'],['setup','Project Setup'],['vault','Document Vault'],['library','Master Library'],['packages','ITP Packages'],['itp','ITP Builder'],['checklists','Checklists & Forms'],['assignments','FAT / Assignments'],['registers','Registers'],['databookBuilder','Data Book Builder'],['reports','Reports & Certificates'],['approval','Approvals'],['register','ITP Register'],['audit','Audit Trail'],['powerbi','Power BI (Internal)'],['settings','Users & Settings']],
      inspector: [['dash','Inspection Queue'],['inspect','Inspect Activity'],['irn','Inspection Record'],['ncr','NCR Register']],
      contractor: [['dash','Pending Reviews'],['ncr','NCR Response']],
      sub: [['inbox','Inbox'],['field','Field Execution']],
      tpi: [['dash','Assigned Tests'],['upload','Upload Report']],
      client: (st.engagementModeByClient.meridian==='selfservice')
        ? [['witness','Witness Point'],['inspect','Run Inspection'],['setup','Project Setup'],['vault','Document Vault'],['packages','ITP Packages'],['assignments','FAT / Assignments'],['registers','Registers'],['dash','KPI Dashboard'],['ncr','NCRs & Observations'],['databook','Data Book'],['audit','Activity Log'],['reports','Reports & Certificates'],['handover','Handover Portal']]
        : [['witness','Witness Point'],['packages','ITP Packages'],['assignments','FAT / Assignments'],['registers','Registers'],['dash','KPI Dashboard'],['ncr','NCRs & Observations'],['databook','Data Book'],['audit','Activity Log'],['reports','Reports & Certificates'],['handover','Handover Portal']]
    };
    const sideLabelMap = { home:'Orbit Hub', admin:'Jags Admin', inspector:'Jags Inspector', contractor:'Main Contractor', sub:'Subcontractor', tpi:'TPI / Lab', client:'Client Portal' };
    const navIconMap = { dash:'grid', setup:'sliders', vault:'folder', library:'book', itp:'layers', packages:'layers', registers:'clipboard', approval:'shield', register:'file', audit:'clock', powerbi:'award', settings:'user', inspect:'search', ncr:'alert', inbox:'mail', field:'clipboard', upload:'upload', witness:'eye', databook:'book', reports:'file', sampleDocs:'file', assignments:'check', handover:'award', irn:'file', checklists:'clipboard', databookBuilder:'book', startWork:'check' };
    const navItems = (navMap[st.role] || []).map(([key,label]) => ({
      label, icon: navIconMap[key], cls: (st.screen===key || (key==='itp' && st.screen==='activity') || (key==='itp' && st.screen==='checklist') || (key==='assignments' && st.screen==='assignmentDetail')) ? 'active' : '',
      go: go(st.role, key)
    }));
    const personaMap = {
      admin: { name:'Priya Desai', role:'Jags Admin · Quality Engineer', initials:'PD', color:'#6B1E2C' },
      inspector: { name:'Ravi Kapoor', role:'Jags Inspector', initials:'RK', color:'#6B1E2C' },
      contractor: { name:'Marcus Tan', role:'Trident Marine · Site Manager', initials:'MT', color:'#8a5a1e' },
      sub: { name:'Sofia Alvarez', role:'BayShore Rebar · Field Technician', initials:'SA', color:'#2f6f4e' },
      tpi: { name:'Dr. Amara Rao', role:'Apex Testing Labs', initials:'AR', color:'#2f5f7a' },
      client: { name:'Naveen Iyer', role:'Meridian Energy · Project Owner', initials:'NI', color:'#4a4038' }
    };
    const viewingAsParty = (st.role==='client' && st.viewingAsAddedPartyIdx!=null) ? st.clientAddedParties[st.viewingAsAddedPartyIdx] : null;
    const persona = viewingAsParty
      ? { name: viewingAsParty.org, role: viewingAsParty.jobRole + ' · Meridian Energy (self-service)', initials: viewingAsParty.org.slice(0,2).toUpperCase(), color:'#2f6f4e' }
      : (personaMap[st.role] || { name:'', role:'', initials:'', color:'#6B1E2C' });
    const isViewingAsParty = !!viewingAsParty;
    const stopViewingAsAddedParty = this.stopViewingAsAddedParty();

    const notifCategoryIcon = { inspection:'eye', ncr:'alert', witness:'user', document:'folder', handover:'award', approval:'check' };
    const notifForRole = st.notifications.filter(n => n.role === st.role).slice().reverse();
    const notifItems = notifForRole.map(n => ({
      id: n.id, text: n.text, t: n.t,
      icon: notifCategoryIcon[n.category] || 'alert',
      cls: n.status === 'unread' ? 'badge-gold' : 'badge-grey',
      statusLabel: n.status === 'unread' ? 'New' : 'Read',
      unread: n.status === 'unread',
      open: this.openNotification(n.id, n.role, n.screen)
    }));
    const notifUnreadCount = notifForRole.filter(n => n.status === 'unread').length;
    const notifBadgeLabel = notifUnreadCount > 9 ? '9+' : String(notifUnreadCount);
    const notifHasUnread = notifUnreadCount > 0;
    const notifItemsEmpty = notifItems.length === 0;

    const resetDemo = this.resetDemo();
    const verifyCsa = this.verifyDiscipline('csaVerified', 'CSA');
    const verifyMep = this.verifyDiscipline('mepVerified', 'MEP');
    const releaseHold = this.releaseHoldPoint();
    const csaDone = !!st.csaVerified, mepDone = !!st.mepVerified;
    const holdReady = csaDone && mepDone && !st.holdReleased;
    const holdLocked = !(csaDone && mepDone) && !st.holdReleased;
    const holdPointLabel = st.holdReleased ? 'Released' : (holdReady ? 'Ready for Jags Release' : 'LOCKED');
    const holdPointCls = st.holdReleased ? 'badge-green' : (holdReady ? 'badge-gold' : 'badge-burg');
    const csaLabel = csaDone ? ('Verified · ' + st.csaVerified) : 'Outstanding';
    const mepLabel = mepDone ? ('Verified · ' + st.mepVerified) : 'Outstanding';
    const csaCls = csaDone ? 'badge-green' : 'badge-gold';
    const mepCls = mepDone ? 'badge-green' : 'badge-gold';
    const holdOutstandingParts = [];
    if (!csaDone) holdOutstandingParts.push('CSA');
    if (!mepDone) holdOutstandingParts.push('MEP');
    const holdOutstandingText = holdOutstandingParts.join(' and ') + ' verification';
    const isNotHome = st.role!=='home';

    const is = {
      home: st.role==='home',
      adminDash: st.role==='admin'&&st.screen==='dash',
      adminSetup: st.role==='admin'&&st.screen==='setup',
      adminVault: st.role==='admin'&&st.screen==='vault',
      adminItp: st.role==='admin'&&st.screen==='itp',
      approvalsCentre: st.screen==='approvalsCentre',
      itpPackagesScreen: (st.role==='admin'||st.role==='client')&&st.screen==='packages',
      registersScreen: (st.role==='admin'||st.role==='client')&&st.screen==='registers',
      packageGen: (st.role==='admin'||st.role==='client')&&st.screen==='packageGen',
      pkgAttach: (st.role==='admin'||st.role==='client')&&st.screen==='packageGen'&&st.itpPackages[st.activeItpPackageIdx].status==='attach',
      pkgProcessing: (st.role==='admin'||st.role==='client')&&st.screen==='packageGen'&&st.itpPackages[st.activeItpPackageIdx].status==='processing',
      pkgReview: (st.role==='admin'||st.role==='client')&&st.screen==='packageGen'&&st.itpPackages[st.activeItpPackageIdx].status==='review',
      adminAiItp: st.role==='admin'&&st.screen==='aiitp',
      aiGenAttach: st.role==='admin'&&st.screen==='aiitp'&&st.aiGenStep==='attach',
      aiGenProcessing: st.role==='admin'&&st.screen==='aiitp'&&st.aiGenStep==='processing',
      aiGenReview: st.role==='admin'&&st.screen==='aiitp'&&st.aiGenStep==='review',
      adminActivity: st.role==='admin'&&st.screen==='activity',
      adminChecklist: st.role==='admin'&&st.screen==='checklist',
      adminApproval: st.role==='admin'&&st.screen==='approval',
      adminAudit: st.role==='admin'&&st.screen==='audit',
      adminLibrary: st.role==='admin'&&st.screen==='library',
      adminHoldpoint: st.role==='admin'&&st.screen==='holdpoint',
      adminPowerbi: st.role==='admin'&&st.screen==='powerbi',
      adminSettings: st.role==='admin'&&st.screen==='settings',
      adminRegister: st.role==='admin'&&st.screen==='register',
      clientWorkspace: st.role==='admin'&&st.screen==='clientWorkspace',
      projectControl: st.role==='admin'&&st.screen==='projectControl',
      myWork: st.role==='admin'&&st.screen==='myWork',
      disciplineWorkspace: st.role==='admin'&&st.screen==='discipline',
      instanceDetail: st.role==='admin'&&st.screen==='instanceDetail',
      clientOnboarding: st.role==='admin'&&st.screen==='onboarding',
      setupParties: st.setupTab==='parties', setupDisciplines: st.setupTab==='disciplines',
      setupLocations: st.setupTab==='locations', setupNumbering: st.setupTab==='numbering', setupEngagement: st.setupTab==='engagement',
      setupBrandMode: st.setupTab==='brandMode',
      inspDash: st.role==='inspector'&&st.screen==='dash',
      inspInspect: st.role==='inspector'&&st.screen==='inspect',
      inspNcr: st.role==='inspector'&&st.screen==='ncr',
      contDash: st.role==='contractor'&&st.screen==='dash',
      contNcr: st.role==='contractor'&&st.screen==='ncr',
      subInbox: st.role==='sub'&&st.screen==='inbox',
      subField: st.role==='sub'&&st.screen==='field',
      tpiDash: st.role==='tpi'&&st.screen==='dash',
      tpiUpload: st.role==='tpi'&&st.screen==='upload',
      cliWitness: st.role==='client'&&st.screen==='witness',
      cliInspect: st.role==='client'&&st.screen==='inspect',
      cliSetup: st.role==='client'&&st.screen==='setup',
      cliVault: st.role==='client'&&st.screen==='vault',
      cliDash: st.role==='client'&&st.screen==='dash',
      cliNcr: st.role==='client'&&st.screen==='ncr',
      cliDatabook: st.role==='client'&&st.screen==='databook',
      cliAudit: st.role==='client'&&st.screen==='audit',
      cliHandover: st.role==='client'&&st.screen==='handover',
      adminStartWork: st.role==='admin'&&st.screen==='startWork',
      adminDatabookBuilder: st.role==='admin'&&st.screen==='databookBuilder',
      adminChecklistBuilder: st.role==='admin'&&st.screen==='checklists',
      inspIrn: st.role==='inspector'&&st.screen==='irn',
      cliReports: (st.role==='admin'||st.role==='client')&&st.screen==='reports',
      sampleDocsScreen: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs',
      sampleItp: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='itp',
      sampleWeekly: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='weekly',
      sampleIrn: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='irn',
      sampleInspectionA4: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='inspectionA4',
      sampleDatabook: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='databook',
      sampleNcrCert: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='ncrCert',
      sampleHandover: (st.role==='admin'||st.role==='client')&&st.screen==='sampleDocs'&&st.reportDocType==='handover',
      sampleDocsAdmin: st.role==='admin'&&st.screen==='sampleDocs',
      reportsAdmin: st.role==='admin'&&st.screen==='reports',
      assignmentsScreen: (st.role==='admin'||st.role==='client')&&st.screen==='assignments',
      assignmentDetail: (st.role==='admin'||st.role==='client')&&st.screen==='assignmentDetail'
    };
    const showFieldChecklist = is.subField || is.cliInspect;
    const fieldSubmittedBannerText = st.role==='client'
      ? 'Submitted — your own team completed this inspection directly on the Jags platform, forwarded for Jags verification.'
      : 'Submitted to Trident Marine Construction for review.';

    const setupTabs =[['parties','Parties'],['disciplines','Disciplines'],['locations','Locations'],['numbering','Numbering'],['engagement','Service Delivery Mode'],['brandMode','Engagement Mode (Branding)']]
      .map(([key,label]) => ({ label, cls: st.setupTab===key ? 'on-yes' : '', go: this.setupGo(key) }));
    const activeEngMode = st.engagementModeByClient[st.activeClient];
    const isManaged = activeEngMode==='managed';
    const isSelfService = !isManaged;
    const meridianEngMode = st.engagementModeByClient.meridian;
    const clientPersonaManaged = meridianEngMode==='managed';
    const clientPersonaSelfService = !clientPersonaManaged;
    const northgateModeLabel = st.engagementModeByClient.northgate==='managed' ? 'Jags-Managed' : 'Client Self-Service';
    const meridianModeLabel = clientPersonaManaged ? 'Jags-Managed' : 'Client Self-Service';
    const contractorActorName = clientPersonaSelfService ? "Meridian Energy's own team" : 'Trident Marine Construction';
    const subActorName = clientPersonaSelfService ? "Meridian Energy's own team" : 'BayShore Rebar Co.';

    const parties = [
      { role:'Contractor', org:'Trident Marine Construction', chain:'Reviews & forwards', contact:'Marcus Tan', email:'m.tan@tridentmarine.example' },
      { role:'Subcontractor', org:'BayShore Rebar Co.', chain:'Executes field work', contact:'Sofia Alvarez', email:'s.alvarez@bayshorerebar.example' },
      { role:'TPI / Lab', org:'Apex Testing Labs', chain:'Independent test', contact:'Dr. Amara Rao', email:'a.rao@apextestinglabs.example' },
      { role:'Jags Assurance', org:'Jags Assurance', chain:'Inspects & certifies', contact:'Priya Desai / Ravi Kapoor', email:'quality@jagsassurance.example' },
      { role:'Client', org:'Meridian Energy', chain:'Witness / final approval', contact:'Naveen Iyer', email:'n.iyer@meridianenergy.example' }
    ];
    const disciplines = ['Civil','Mechanical','Electrical','Piping'];
    const vaultFolders = [
      ['01 Drawings','12'],['02 Specifications','2'],['03 Standards & Codes','6'],['04 Material Submittals','4'],
      ['05 RFIs','3'],['06 Method Statements','5'],['07 ITPs','1'],['08 Checklists & Forms','1'],
      ['09 Approvals & Correspondence','2'],['10 Certificates','0'],['11 General Reference','3']
    ].map(([name,count]) => ({
      name, count: String(Number(count) + st.clientUploadedDocs.filter(d => d.category === name).length),
      selected: st.uploadCategory === name, catCls: st.uploadCategory === name ? 'on-yes' : '', selectCat: this.setUploadCategory(name)
    }));
    const uploadReqExplainer = 'A complete ITP typically needs a Drawing, a Specification, and (where relevant) a Method Statement or Test Standard — pick the category each file belongs to so AI drafting and the ITP Register both point to the right revision.';
    const northgateVaultFolders = [
      ['01 Drawings','2'],['02 Specifications','2'],['03 Standards & Codes','1'],['04 Material Submittals','0'],
      ['05 RFIs','1'],['06 Method Statements','0'],['07 ITPs','1'],['08 Checklists & Forms','0'],
      ['09 Approvals & Correspondence','0'],['10 Certificates','0'],['11 General Reference','1']
    ].map(([name,count]) => ({ name, count }));

    const itpSections = [
      { name:'1 Submittals', count:'3 activities', expanded:false },
      { name:'2 Materials', count:'4 activities', expanded:false },
      { name:'3 Execution', count:'9 activities', expanded:true },
      { name:'4 Testing & Reports', count:'4 activities', expanded:false },
      { name:'5 Documentation & Closeout', count:'2 activities', expanded:false }
    ];
    const aiGenSectionCount = itpSections.length;

    const hwrsMap = [ ['Contractor','H','badge-burg'], ['Subcontractor','R','badge-blue'], ['TPI / Lab','RE','badge-grey'], ['Jags Assurance','R','badge-blue'], ['Client','W','badge-amber'] ];
    const hwrs = hwrsMap.map(([party,val,cls]) => ({ party, val, cls }));

    const checklistItems = [
      { n:1, text:'Rebar size and spacing per drawing' },
      { n:2, text:'Cover blocks installed at required spacing', measured:'42 mm cover' },
      { n:3, text:'Lap lengths comply with drawing' },
      { n:4, text:'Reinforcement free of rust / scale' },
      { n:5, text:'Tie wire secure, no protrusions' }
    ];

    const signKeys = [['Contractor','contractor'],['Subcontractor','subcontractor'],['TPI / Lab','tpi'],['Jags Assurance','jags'],['Client','client']];
    const meridianPartyActive = st.partyActiveByClient.meridian;
    const activeMeridianSignKeys = signKeys.filter(([party,key]) => meridianPartyActive[key]);
    const clientAddedSignRows = st.clientAddedParties.map((p, i) => ({
      party: p.org, label: p.signed ? ('Signed · ' + p.signed) : 'Pending', cls: p.signed ? 'badge-green' : 'badge-gold', canSign: !p.signed, signFn: this.signAddedParty(i)
    }));
    const clientAddedPartyRows = st.clientAddedParties.map((p, i) => ({
      role: p.role, jobRole: p.jobRole, org: p.org, chain: p.chain, contact: p.contact,
      label: p.signed ? ('Signed · ' + p.signed) : 'Pending', cls: p.signed ? 'badge-green' : 'badge-gold',
      canSign: !p.signed, signFn: this.signAddedParty(i), canRemove: !p.signed, removeFn: this.removeClientParty(i),
      viewing: st.viewingAsAddedPartyIdx === i, viewAs: this.viewAsAddedParty(i)
    }));
    const signRows = [...activeMeridianSignKeys.map(([party,key]) => {
      const val = st.sign[key];
      return { party, label: val ? ('Signed · ' + val) : 'Pending', cls: val ? 'badge-green' : 'badge-gold', canSign: !val, signFn: this.signParty(key, party) };
    }), ...clientAddedSignRows];
    const clientAddedSignedCount = st.clientAddedParties.filter(p => p.signed).length;
    const totalSignSlots = activeMeridianSignKeys.length + st.clientAddedParties.length;
    const allSigned = activeMeridianSignKeys.every(([party,key]) => st.sign[key]) && st.clientAddedParties.every(p => p.signed);
    const signedCount = activeMeridianSignKeys.filter(([party,key]) => st.sign[key]).length + clientAddedSignedCount;
    const registerMeridianOpen = allSigned ? 'None' : ((totalSignSlots - signedCount) + ' sign-offs remaining');
    const northgatePartyActive = st.partyActiveByClient.northgate;
    const activeNorthgateSignKeys = signKeys.filter(([party,key]) => northgatePartyActive[key]);
    const northgateTotalSlots = activeNorthgateSignKeys.length;
    const northgateSignedCount = activeNorthgateSignKeys.filter(([party,key]) => st.northgateSign[key]).length;
    const northgateOpenText = northgateSignedCount===northgateTotalSlots ? 'None' : ((northgateTotalSlots - northgateSignedCount) + ' sign-offs remaining');
    const meridianItpPct = totalSignSlots ? Math.round((signedCount/totalSignSlots)*100) : 0;
    const checklistBuilderTemplateType = st.checklistBuilderTemplateType || 'checklist';
    const checklistBuilderIsChecklist = checklistBuilderTemplateType === 'checklist';
    const checklistBuilderIsForm = checklistBuilderTemplateType === 'form';
    const checklistBuilderChecklistBtnCls = checklistBuilderIsChecklist ? 'btn-primary' : 'btn-outline';
    const checklistBuilderFormBtnCls = checklistBuilderIsForm ? 'btn-primary' : 'btn-outline';
    const checklistBuilderSetTypeChecklist = this.setChecklistTemplateType('checklist');
    const checklistBuilderSetTypeForm = this.setChecklistTemplateType('form');
    const checklistBuilderPreviewMode = st.checklistBuilderPreviewMode || 'tablet';
    const checklistBuilderIsTablet = checklistBuilderPreviewMode === 'tablet';
    const checklistBuilderIsDesktop = checklistBuilderPreviewMode === 'desktop';
    const checklistBuilderDesktopBtnCls = checklistBuilderIsDesktop ? 'btn-primary' : 'btn-outline';
    const checklistBuilderTabletBtnCls = checklistBuilderIsTablet ? 'btn-primary' : 'btn-outline';
    const checklistBuilderSetPreviewDesktop = this.setChecklistPreviewMode('desktop');
    const checklistBuilderSetPreviewTablet = this.setChecklistPreviewMode('tablet');
    const checklistBuilderItemCount = (st.checklistBuilderItems || []).length;
    const checklistBuilderAnsweredLabel = '0 of ' + checklistBuilderItemCount + ' answered';
    const checklistBuilderRows = (st.checklistBuilderItems || []).map((it, i) => {
      const expanded = st.checklistBuilderExpandedIdx === i;
      return {
        n: it.n, text: it.text, type: it.type,
        mandatory: it.mandatory,
        mandCls: it.mandatory ? 'on' : '',
        expanded,
        allowMeasured: !!it.allowMeasured,
        allowMeasuredMark: it.allowMeasured ? '☑' : '☐',
        unit: it.unit || '',
        photoOnNo: !!it.photoOnNo,
        photoOnNoMark: it.photoOnNo ? '☑' : '☐',
        helper: it.helper || '',
        toggleFn: this.toggleChecklistItemExpanded(i),
        toggleMandFn: this.toggleChecklistItemMandatory(i),
        copyFn: this.checklistBuilderNoop(),
        deleteFn: this.checklistBuilderNoop()
      };
    });
    const checklistBuilderPreviewItems = (st.checklistBuilderItems || []).slice(0, 2).map((it) => ({ n: it.n, text: it.text }));
    const checklistBuilderNoop = this.checklistBuilderNoop();

    // Power BI Command Centre charts
    const powerbiMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'];
    const powerbiFilters = {
      dateLabel: 'FY2026', regionLabel: 'All', clientLabel: 'All', projectLabel: 'All',
      clearFiltersFn: this.checklistBuilderNoop()
    };

    // --- Inspections completed vs planned (grouped bars + completion% line) ---
    const powerbiInspectionsChart = (function buildInspectionsChart(){
      const completed = [780, 850, 900, 950, 1020, 1080, 1140, 1200];
      const planned =   [850, 900, 950, 1000, 1100, 1150, 1200, 1250];
      const yMax = 1600;
      const plotLeft = 40, plotRight = 580, plotTop = 10, plotBottom = 190;
      const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;
      const slotW = plotW / powerbiMonths.length;
      const barW = 20, gap = 4;
      const scaleY = (v) => plotBottom - (v / yMax) * plotH;
      const scalePctY = (p) => plotBottom - (p / 100) * plotH;
      const bars = powerbiMonths.map((m, i) => {
        const slotX = plotLeft + i * slotW;
        const completedX = slotX + (slotW - (barW * 2 + gap)) / 2;
        const plannedX = completedX + barW + gap;
        const completedY = scaleY(completed[i]);
        const plannedY = scaleY(planned[i]);
        const lineX = slotX + slotW / 2;
        const pct = Math.round((completed[i] / planned[i]) * 1000) / 10;
        return {
          month: m,
          completedX: completedX.toFixed(1), completedY: completedY.toFixed(1), completedH: (plotBottom - completedY).toFixed(1),
          plannedX: plannedX.toFixed(1), plannedY: plannedY.toFixed(1), plannedH: (plotBottom - plannedY).toFixed(1),
          lineX: lineX.toFixed(1), lineY: scalePctY(pct).toFixed(1),
          labelX: lineX.toFixed(1), completedVal: completed[i], plannedVal: planned[i], pctLabel: pct.toFixed(1) + '%'
        };
      });
      const completionLinePoints = bars.map((b) => b.lineX + ',' + b.lineY).join(' ');
      const yAxis = [0, 400, 800, 1200, 1600].map((v) => ({ v, y: scaleY(v).toFixed(1) }));
      const pctAxis = [0, 25, 50, 75, 100].map((p) => ({ p, y: scalePctY(p).toFixed(1) }));
      return { bars, completionLinePoints, yAxis, pctAxis };
    })();

    // --- First-time pass rate trend (line + dashed target reference) ---
    const powerbiPassRateChart = (function buildPassRateChart(){
      const values = [91.4, 92.0, 92.7, 93.1, 93.6, 94.0, 93.3, 93.8];
      const domainMin = 80, domainMax = 100;
      const plotLeft = 40, plotRight = 600, plotTop = 15, plotBottom = 170;
      const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;
      const scaleY = (v) => plotBottom - ((v - domainMin) / (domainMax - domainMin)) * plotH;
      const stepX = plotW / (powerbiMonths.length - 1);
      const points = powerbiMonths.map((m, i) => {
        const x = plotLeft + i * stepX;
        const y = scaleY(values[i]);
        return { month: m, x: x.toFixed(1), y: y.toFixed(1), labelY: (y - 10).toFixed(1), valLabel: values[i].toFixed(1) + '%' };
      });
      const linePoints = points.map((p) => p.x + ',' + p.y).join(' ');
      const targetY = scaleY(90).toFixed(1);
      const yAxis = [80, 85, 90, 95, 100].map((v) => ({ v, y: scaleY(v).toFixed(1) }));
      return { points, linePoints, targetY, plotLeft, plotRight, yAxis };
    })();

    // --- NCR trend: Open vs Closed stacked bars + Net Open line ---
    const powerbiNcrTrendChart = (function buildNcrTrendChart(){
      const open =   [38, 40, 44, 48, 45, 41, 37, 34];
      const closed = [44, 42, 45, 46, 44, 43, 40, 41];
      const yMax = 100;
      const plotLeft = 40, plotRight = 600, plotTop = 10, plotBottom = 190;
      const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;
      const slotW = plotW / powerbiMonths.length;
      const barW = 34;
      const scaleY = (v) => plotBottom - (v / yMax) * plotH;
      const bars = powerbiMonths.map((m, i) => {
        const slotX = plotLeft + i * slotW;
        const barX = slotX + (slotW - barW) / 2;
        const openY = scaleY(open[i]);
        const openH = plotBottom - openY;
        const closedTop = open[i] + closed[i];
        const closedY = scaleY(closedTop);
        const closedH = openY - closedY;
        const netX = slotX + slotW / 2;
        return {
          month: m, barX: barX.toFixed(1),
          openY: openY.toFixed(1), openH: openH.toFixed(1),
          closedY: closedY.toFixed(1), closedH: closedH.toFixed(1),
          netX: netX.toFixed(1), netY: openY.toFixed(1),
          labelX: netX.toFixed(1), openVal: open[i], closedVal: closed[i], netVal: open[i]
        };
      });
      const netLinePoints = bars.map((b) => b.netX + ',' + b.netY).join(' ');
      const yAxis = [0, 20, 40, 60, 80, 100].map((v) => ({ v, y: scaleY(v).toFixed(1) }));
      return { bars, netLinePoints, yAxis, finalOpen: open[open.length - 1], finalClosed: closed[closed.length - 1] };
    })();

    // --- Hold-point turnaround gauge (reuses donut-arc pattern) ---
    const powerbiHoldPointAvg = 6.2;
    const powerbiHoldPointTarget = 8;
    const powerbiHoldPointArcPct = Math.round((powerbiHoldPointAvg / powerbiHoldPointTarget) * 1000) / 10;
    const powerbiHoldPointMet = powerbiHoldPointAvg <= powerbiHoldPointTarget;
    const powerbiHoldPointGauge = {
      arc: powerbiHoldPointArcPct + ', 100',
      avgHours: powerbiHoldPointAvg.toFixed(1) + 'h',
      targetLabel: '< ' + powerbiHoldPointTarget + 'h',
      statusLabel: powerbiHoldPointMet ? 'Target met' : 'Above target',
      statusCls: powerbiHoldPointMet ? 'badge-green' : 'badge-red',
      caption: powerbiHoldPointMet
        ? ('Average turnaround is ' + (powerbiHoldPointTarget - powerbiHoldPointAvg).toFixed(1) + 'h under target.')
        : ('Average turnaround is ' + (powerbiHoldPointAvg - powerbiHoldPointTarget).toFixed(1) + 'h over target.')
    };

    // --- Data-book readiness by project (horizontal bars, sorted desc) ---
    const powerbiReadinessByProject = [
      { name: 'Coastal LNG Terminal Ph.2 (Meridian Energy)', pct: 96, barColor: '#6B1E2C' },
      { name: 'Signal Renewal Package 3 (Northgate Rail)', pct: 89, barColor: '#6B1E2C' },
      { name: 'Harbourfront Tower Redevelopment', pct: 84, barColor: '#6B1E2C' },
      { name: 'Riverside Commercial Hub', pct: 73, barColor: '#9a5b0a' },
      { name: 'Metro Station Upgrade', pct: 61, barColor: '#9a5b0a' },
      { name: 'Coastal Water Treatment Plant', pct: 42, barColor: '#a6324a' }
    ];

    // --- Vendor performance league table (with inline sparkline trend) ---
    const powerbiVendorLeague = (function buildVendorLeague(){
      const buildSpark = (vals, good) => {
        const w = 60, h = 24, pad = 3;
        const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        const span = (max - min) || 1;
        const stepX = (w - pad * 2) / (vals.length - 1);
        const pts = vals.map((v, i) => {
          const x = pad + i * stepX;
          const y = h - pad - ((v - min) / span) * (h - pad * 2);
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
        return { points: pts, color: good ? '#2f6f4e' : '#a6324a' };
      };
      const rows = [
        { rank: 1, name: 'Apex Electrical', inspections: 1248, passRate: 97.2, passCls: 'badge-green', openNcrs: 4, spark: [3, 4, 3, 5, 4, 6], good: true },
        { rank: 2, name: 'Northstar Civil', inspections: 1102, passRate: 94.1, passCls: 'badge-green', openNcrs: 7, spark: [2, 3, 3, 4, 5, 5], good: true },
        { rank: 3, name: 'Delta Mechanical', inspections: 968, passRate: 91.8, passCls: 'badge-gold', openNcrs: 11, spark: [6, 5, 5, 4, 4, 3], good: false },
        { rank: 4, name: 'Vector Controls', inspections: 854, passRate: 88.7, passCls: 'badge-red', openNcrs: 12, spark: [6, 6, 5, 4, 3, 2], good: false }
      ].map((v) => {
        const s = buildSpark(v.spark, v.good);
        return {
          rank: v.rank, name: v.name, inspections: v.inspections,
          passRateLabel: v.passRate.toFixed(1) + '%', passCls: v.passCls,
          openNcrs: v.openNcrs, sparkPoints: s.points, sparkColor: s.color
        };
      });
      return rows;
    })();

    const startWorkIsItp = st.startWorkMode === 'itp';

    // FAT assignment type tabs
    const assignmentTypeTabs = [['FAT','FAT'],['Witness inspection','Witness inspection'],['Specific test','Specific test'],['Pre-shipment','Pre-shipment']].map(([k,label]) => ({
      key:k, label, cls: st.assignmentTypeTab===k ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm', go: this.setAssignmentTypeTab(k)
    }));
    const assignmentDetailTabDefs = [['measurements','Measurements'],['photos','Photos'],['punch','Punch List'],['witness','Witness Signatures'],['notes','Notes']];
    const assignmentDetailTabs = assignmentDetailTabDefs.map(([k,label]) => ({
      key:k, label, cls: st.assignmentDetailTab===k ? 'inspectortab active' : 'inspectortab', go: this.setAssignmentDetailTab(k), visible: st.assignmentDetailTab===k
    }));
    const assignmentTabMeasurementsVisible = st.assignmentDetailTab === 'measurements';
    const assignmentTabPhotosVisible = st.assignmentDetailTab === 'photos';
    const assignmentTabPunchVisible = st.assignmentDetailTab === 'punch';
    const assignmentTabWitnessVisible = st.assignmentDetailTab === 'witness';
    const assignmentTabNotesVisible = st.assignmentDetailTab === 'notes';
    // end FAT assignment type tabs

    const sampleInspectionA4 = {
      docNo:'MER-JAGS-IR-0148', rev:'0', date:'07 Sep 2026', page:'1 of 1',
      trace: {
        project:'Coastal LNG Terminal Expansion — Package 4', client:'Meridian Energy',
        itpProcedure:'MER-JAGS-ITP-001', location:'Substation Building 2 — LV Switchroom',
        discipline:'Electrical', drawing:'EL-204 Rev C', inspector:'Priya Nair'
      },
      summary: { statusLabel:'PASS', statusCls:'badge-green', checksCompleted:5, nonConformances:0, observationsCount:1 },
      results: [
        { item:'01', point:'Cable route matches latest approved drawing', reference:'EL-204 Rev C', resultLabel:'PASS', resultCls:'badge-green', evidenceRef:'Photo 1' },
        { item:'02', point:'Support spacing complies (max. 1.2 m)', reference:'EL-204 Rev C, Sec 3.2', resultLabel:'PASS', resultCls:'badge-green', evidenceRef:'Photo 2' },
        { item:'03', point:'Minimum bend radius maintained (measured 312 mm)', reference:'EL-204 Rev C, Note 4', resultLabel:'PASS', resultCls:'badge-green', evidenceRef:'Photo 2' },
        { item:'04', point:'Power / control segregation (300 mm min.)', reference:'EL-204 Rev C, Sec 3.4', resultLabel:'PASS', resultCls:'badge-green', evidenceRef:'Photo 3' },
        { item:'05', point:'Cable identification and ferrule labelling', reference:'EL-204 Rev C, Note 5', resultLabel:'N/A', resultCls:'badge-grey', evidenceRef:'—' }
      ],
      photos: [
        { name:'IMG_3194', caption:'Photo 1 — Cable route at Grid C2', color:'#8a5a1e' },
        { name:'IMG_3195', caption:'Photo 2 — Support spacing at 1.2 m', color:'#4a3a7a' },
        { name:'IMG_3198', caption:'Photo 3 — Bend radius verification', color:'#2f6f4e' }
      ],
      conclusion:'The inspection of the installed LV feeder cabling within Substation Building 2 — LV Switchroom has been completed in accordance with ITP MER-JAGS-ITP-001. All inspected items comply with the specified requirements against drawing EL-204 Rev C. The inspection status is PASS.',
      observations: [
        'Minor excess cable length observed near the Grid C4 termination. Recommend tidying and re-securing to maintain optimal bend radius and appearance.'
      ],
      sigs: [
        { name:'Priya Nair', role:'Inspector', org:'Jags Assurance', date:'07 Sep 2026' },
        { name:'Marcus Tan', role:'Contractor Witness', org:'Trident Marine Construction', date:'07 Sep 2026' },
        { name:'Naveen Iyer', role:'Client Representative', org:'Meridian Energy', date:'07 Sep 2026' }
      ]
    };
    const startWorkIsStandalone = st.startWorkMode === 'standalone';
    const startWorkItpCardCls = startWorkIsItp ? 'wmcard selected' : 'wmcard';
    const startWorkStandaloneCardCls = startWorkIsStandalone ? 'wmcard selected' : 'wmcard';
    const startWorkSelectedLabel = startWorkIsItp ? 'ITP-driven project' : 'Standalone assignment';
    const startWorkSelectItp = this.selectStartWorkMode('itp');
    const startWorkSelectStandalone = this.selectStartWorkMode('standalone');
    const startWorkCancel = go('admin','dash');
    const startWorkContinue = startWorkIsStandalone ? go('admin','assignments') : go('admin','setup');
    // NOTE: assignment-photo/FAT-report computed values (assignmentPhotoRows, fatReportChecklistRows,
    // fatReportPunchRows, fatConditionalPass, fatReportPhotoRows, fatDocNo/fatRev/fatDate/fatPage) live
    // further below, immediately after `const activeAssignment = { ...activeAssignmentRaw, ... }` —
    // they depend on activeAssignmentRaw which is not computed until that point.
    const northgateItpPct = northgateTotalSlots ? Math.round((northgateSignedCount/northgateTotalSlots)*100) : 0;

    // ---- Inspection Record (IRN) demo screen — inspector role, static read-only data ----
    const irnRecord = {
      number: 'IR-EL-2026-0148',
      crumbProject: 'Coastal LNG Terminal',
      crumbSection: 'Inspections',
      statusChips: [ { label:'Passed', cls:'badge-green' }, { label:'Released', cls:'badge-grey' } ],
      meta: {
        project:'Coastal LNG Terminal', client:'Meridian Energy', itp:'MER-JAGS-ITP-001 / Activity 2.1',
        checklist:'MER-JAGS-CHK-001', location:'Substation Building 2 / LV Switchroom',
        drawing:'EL-204 Rev C', inspector:'Ravi Kapoor', date:'07 Sep 2026'
      },
      tally: { items:5, yes:4, no:0, na:1 },
      resultLabel:'PASS',
      rows: [
        { n:'01', requirement:'Cable route matches latest approved drawing', result:'Yes', resultCls:'badge-green', comment:'EL-204 Rev C verified', photo:{ name:'IMG_3194', caption:'Cable route at Grid C2', color:'#8a5a1e' } },
        { n:'02', requirement:'Support spacing complies', result:'Yes', resultCls:'badge-green', comment:'Maximum spacing 1.2 m', photo:{ name:'IMG_3195', caption:'Support spacing at 1.2 m', color:'#4a3a7a' } },
        { n:'03', requirement:'Minimum bend radius maintained', result:'Yes', resultCls:'badge-green', comment:'Measured 312 mm; minimum 300 mm', photo:{ name:'IMG_3198', caption:'Bend radius 312 mm', color:'#2f6f4e' } },
        { n:'04', requirement:'Power/control segregation', result:'Yes', resultCls:'badge-green', comment:'300 mm separation confirmed', photo:null },
        { n:'05', requirement:'Cable identification', result:'N-A', resultCls:'badge-grey', comment:'Route inspection only', photo:null }
      ],
      leadInspector: { name:'Ravi Kapoor', role:'Lead Inspector', signedDate:'07 Sep 2026 14:45' },
      approvalStages: [
        { num:1, label:'Subcontractor signed', name:'Sofia Alvarez', date:'07 Sep 2026 11:10', done:true, notDone:false, dotCls:'done', lineCls:'', labelCls:'' },
        { num:2, label:'Contractor signed', name:'Marcus Tan', date:'07 Sep 2026 12:05', done:true, notDone:false, dotCls:'done', lineCls:'filled', labelCls:'' },
        { num:3, label:'Jags released', name:'Ravi Kapoor', date:'07 Sep 2026 14:45', done:true, notDone:false, dotCls:'done', lineCls:'filled', labelCls:'' }
      ],
      auditTrail: [
        { time:'07 Sep 2026 14:45', text:'Released by Ravi Kapoor (Jags)' },
        { time:'07 Sep 2026 12:05', text:'Signed by Marcus Tan (Contractor)' },
        { time:'07 Sep 2026 11:10', text:'Signed by Sofia Alvarez (Subcontractor)' },
        { time:'07 Sep 2026 09:20', text:'Created by Ravi Kapoor' }
      ],
      doc: {
        irnNo:'MER-JAGS-IRN-00148', revision:'0', date:'07 Sep 2026', page:'1 of 1',
        project:'Coastal LNG Terminal', client:'Meridian Energy', contractor:'Trident Marine Construction',
        itpRef:'MER-JAGS-ITP-001 / Activity 2.1', inspectionRecord:'IR-EL-2026-0148',
        location:'Substation Building 2 / LV Switchroom', discipline:'Electrical', drawing:'EL-204 Rev C',
        bannerNote:'Cable installation and routing has been inspected against the approved ITP, specification and drawing.',
        releaseScope:{ area:'LV Switchroom', route:'Grid C2–C6', completedDate:'07 Sep 2026' },
        sigs: [
          { role:'Subcontractor', name:'Sofia Alvarez', date:'07 Sep 2026' },
          { role:'Main Contractor', name:'Marcus Tan', date:'07 Sep 2026' },
          { role:'Jags', name:'Ravi Kapoor', date:'07 Sep 2026' },
          { role:'Client Witness', name:'Priya Nair', date:'07 Sep 2026' }
        ],
        footer:'MER-JAGS-IRN-00148 · Revision 0 · Uncontrolled when printed · jagsassurance.com'
      }
    };
    const databookBuilderSections = [
      { n:'1', icon:'clipboard', label:'ITPs', verifiedCount:12, totalCount:12, pctLabel:'12 of 12 verified', pct:100, barColor:'#2f6f4e', complete:true, statusLabel:'Complete', statusCls:'badge-green', statusIcon:'check', statusIconColor:'#2f6f4e', hasReviewLink:false },
      { n:'2', icon:'clipboard', label:'Inspection records', verifiedCount:146, totalCount:146, pctLabel:'146 of 146 verified', pct:100, barColor:'#2f6f4e', complete:true, statusLabel:'Complete', statusCls:'badge-green', statusIcon:'check', statusIconColor:'#2f6f4e', hasReviewLink:false },
      { n:'3', icon:'flask', label:'Test certificates', verifiedCount:28, totalCount:30, pctLabel:'28 of 30 verified', pct:93, barColor:'#e0a63a', complete:false, statusLabel:'Incomplete', statusCls:'badge-amber', statusIcon:'alert', statusIconColor:'#9a5b0a', hasReviewLink:true, reviewLinkText:'Review 2 missing' },
      { n:'4', icon:'alert', label:'NCRs closed', verifiedCount:17, totalCount:18, pctLabel:'17 of 18 verified', pct:94, barColor:'#a6324a', complete:false, statusLabel:'Incomplete', statusCls:'badge-red', statusIcon:'alert', statusIconColor:'#a6324a', hasReviewLink:true, reviewLinkText:'1 NCR still open' },
      { n:'5', icon:'layers', label:'As-built drawings', verifiedCount:24, totalCount:24, pctLabel:'24 of 24 verified', pct:100, barColor:'#2f6f4e', complete:true, statusLabel:'Complete', statusCls:'badge-green', statusIcon:'check', statusIconColor:'#2f6f4e', hasReviewLink:false }
    ];
    const databookBuilderVerifiedCount = databookBuilderSections.reduce((sum,s) => sum + s.verifiedCount, 0);
    const databookBuilderTotalCount = databookBuilderSections.reduce((sum,s) => sum + s.totalCount, 0);
    const databookBuilderOutstandingCount = databookBuilderTotalCount - databookBuilderVerifiedCount;
    const databookBuilderReadinessPct = Math.round((databookBuilderVerifiedCount/databookBuilderTotalCount)*100);
    const databookBuilderCanCompile = databookBuilderSections.every(s => s.complete);
    const databookBuilder = {
      sections: databookBuilderSections,
      recentEvents: [
        { icon:'check', iconBg:'#dcefe1', iconColor:'#2f6f4e', title:'Inspection record verified', ref:'IR-PL-0456 — Cryogenic Piping Spool 23', verifier:'Priya Desai', when:'06 Sep 2026 · 14:31', statusLabel:'Verified', statusCls:'badge-green' },
        { icon:'alert', iconBg:'#fde3c4', iconColor:'#9a5b0a', title:'Missing test certificate', ref:'TC-EL-0789 — Cable Gland Type E1FW', verifier:'Priya Desai', when:'06 Sep 2026 · 14:29', statusLabel:'Outstanding', statusCls:'badge-amber' },
        { icon:'alert', iconBg:'#f6dade', iconColor:'#a6324a', title:'NCR closure pending client sign-off', ref:'MER-NCR-2026-004 — Weld repair verification', verifier:'Priya Desai', when:'06 Sep 2026 · 11:05', statusLabel:'Outstanding', statusCls:'badge-red' },
        { icon:'check', iconBg:'#dcefe1', iconColor:'#2f6f4e', title:'As-built drawing verified', ref:'AB-DWG-024 — Piperack Elevation Rev 3', verifier:'Priya Desai', when:'05 Sep 2026 · 16:47', statusLabel:'Verified', statusCls:'badge-green' }
      ],
      readinessPct: databookBuilderReadinessPct,
      readinessArc: databookBuilderReadinessPct + ', 100',
      verifiedCount: databookBuilderVerifiedCount,
      outstandingCount: databookBuilderOutstandingCount,
      lastChecked: '06 Sep 2026 · 14:32',
      canCompile: databookBuilderCanCompile,
      outstandingRecordsMsg: 'Resolve ' + databookBuilderOutstandingCount + ' outstanding records to continue',
      handoverPackage: { volumeNaming:'GFL-QD-001', format:'Searchable PDF + index', client:'Meridian Energy Holdings' }
    };
    const itpRegisterStats = [
      { n: '2', l: 'Total ITPs' },
      { n: '0', l: 'Issued' },
      { n: '2', l: 'Draft' },
      { n: '0', l: 'Superseded' }
    ];

    const CLIENTS = {
      meridian: {
        org:'Meridian Energy', project:'Coastal LNG Terminal Ph.2',
        parties, disciplines, vaultFolders,
        locations:[
          { code:'F-001', desc:'Foundation — Tank Farm North' },
          { code:'F-002', desc:'Foundation — Tank Farm South' },
          { code:'PL-014', desc:'Pipe Rack, Section 14' }
        ],
        numbering:{ itp:'MER-JAGS-ITP-{SEQ}', chk:'MER-JAGS-CHK-{ITPSEQ}-{ACTIVITY}', ncr:'MER-NCR-{YEAR}-{SEQ}', irn:'MER-JAGS-IRN-{SEQ}' },
        vaultDocs:[
          { name:'DRG-CIV-001 — Foundation Reinforcement Detail', rev:'Rev 3', by:'Priya Desai', date:'2026-08-14', size:'2.1 MB', id:'DRG-CIV-0001', discipline:'Civil', pages:22, statusLabel:'Approved', statusCls:'badge-green', linkedStandards:['ACI 318','ASTM A615'] },
          { name:'SPEC-CIV-014 — Civil Concrete & Reinforcement Spec', rev:'Rev 1', by:'Priya Desai', date:'2026-08-14', size:'640 KB', id:'SPEC-CIV-0014', discipline:'Civil', pages:86, statusLabel:'Approved', statusCls:'badge-green', linkedStandards:['ACI 318','ASTM C1712','ISO 9001'] }
        ],
        activity:{ num:'2.1', name:'Reinforcement Inspection', discipline:'Civil', location:'Foundation F-001', ref:'DRG-CIV-001 Rev 3', records:'MER-JAGS-CHK-001-2.1', criteria:'Per approved drawing/spec', method:'Visual / Dimensional', frequency:'Each foundation', notice:'24 hours' },
        hwrs, checklist: checklistItems,
        signStateField:'sign', signOrgs:{ contractor:'Trident Marine Construction', subcontractor:'BayShore Rebar Co.', tpi:'Apex Testing Labs', jags:'Jags Assurance', client:'Meridian Energy' }
      },
      northgate: {
        org:'Northgate Rail', project:'Signal Renewal Package 3',
        parties:[
          { role:'Contractor', org:'Ferrovia Rail Systems', chain:'Reviews & forwards', contact:'Elena Osei', email:'e.osei@ferroviarail.example' },
          { role:'Subcontractor', org:'SignalTech Installations', chain:'Executes field work', contact:'Tom Whitfield', email:'t.whitfield@signaltech.example' },
          { role:'TPI / Lab', org:'Kestrel Test & Certification', chain:'Independent test', contact:'Priya Nair', email:'p.nair@kestreltest.example' },
          { role:'Jags Assurance', org:'Jags Assurance', chain:'Inspects & certifies', contact:'Priya Desai / Ravi Kapoor', email:'quality@jagsassurance.example' },
          { role:'Client', org:'Northgate Rail', chain:'Witness / final approval', contact:'Grace Okafor', email:'g.okafor@northgaterail.example' }
        ],
        disciplines:['Signalling','Civil','Electrical','Telecoms'],
        locations:[
          { code:'SEC-03', desc:'Signal Section 3' },
          { code:'CAB-11', desc:'Cable Route 11' },
          { code:'REL-07', desc:'Relay Room 7' }
        ],
        vaultFolders: northgateVaultFolders,
        numbering:{ itp:'NGR-JAGS-ITP-{SEQ}', chk:'NGR-JAGS-CHK-{ITPSEQ}-{ACTIVITY}', ncr:'NGR-NCR-{YEAR}-{SEQ}', irn:'NGR-JAGS-IRN-{SEQ}' },
        vaultDocs:[
          { name:'SPEC-SIG-004 — Signal Cable Termination Spec', rev:'Rev 2', by:'Priya Desai', date:'2026-08-22', size:'1.4 MB', id:'SPEC-SIG-0004', discipline:'Signalling', pages:54, statusLabel:'Approved', statusCls:'badge-green', linkedStandards:['IEC 60204-1','ISO 9001'] },
          { name:'DRG-SIG-011 — Cable Route Section 3', rev:'Rev 1', by:'Priya Desai', date:'2026-08-22', size:'3.0 MB', id:'DRG-SIG-0011', discipline:'Signalling', pages:12, statusLabel:'Approved', statusCls:'badge-green', linkedStandards:['IEC 60204-1'] }
        ],
        activity:{ num:'4.2', name:'Signal Cable Termination Inspection', discipline:'Signalling', location:'Section 3 Cable Route', ref:'DRG-SIG-011 Rev 1', records:'NGR-JAGS-CHK-004-4.2', criteria:'Per manufacturer termination procedure', method:'Visual / Test / Continuity', frequency:'Each termination joint', notice:'48 hours' },
        hwrs:[
          { party:'Contractor', val:'H', cls:'badge-burg' }, { party:'Subcontractor', val:'R', cls:'badge-blue' },
          { party:'TPI / Lab', val:'W', cls:'badge-amber' }, { party:'Jags Assurance', val:'R', cls:'badge-blue' }, { party:'Client', val:'S', cls:'badge-green' }
        ],
        checklist:[
          { n:1, text:'Cable identification tags match schematic' }, { n:2, text:'Termination torque within manufacturer spec' },
          { n:3, text:'Continuity test passed' }, { n:4, text:'Earth bonding continuity verified' }
        ],
        signStateField:'northgateSign', signOrgs:{ contractor:'Ferrovia Rail Systems', subcontractor:'SignalTech Installations', tpi:'Kestrel Test & Certification', jags:'Jags Assurance', client:'Northgate Rail' }
      }
    };
    const clientData = CLIENTS[st.activeClient];

    const vaultTotalDocs = vaultFolders.reduce((s,f) => s + Number(f.count||0), 0);
    const vaultStats = [
      { n: String(vaultTotalDocs), l:'documents' },
      { n: '96', l:'controlled' },
      { n: '23', l:'awaiting review' },
      { n: '4 min ago', l:'Synced' }
    ];
    const vaultFolderRows = vaultFolders.map((f) => ({
      name: f.name, count: f.count,
      cls: st.vaultActiveFolder === f.name ? 'folder folder-active' : 'folder',
      go: this.selectVaultFolder(f.name)
    }));
    const vaultIsSpecFolder = st.vaultActiveFolder === '02 Specifications';
    const vaultDocRows = !vaultIsSpecFolder ? [] : clientData.vaultDocs.map((v, i) => ({
      ...v, idx: i,
      rowCls: st.vaultSelectedDocIdx === i ? 'vaultdocrow selected' : 'vaultdocrow',
      go: this.selectVaultDoc(i)
    }));
    const vaultSelectedDocRaw = vaultIsSpecFolder ? clientData.vaultDocs[st.vaultSelectedDocIdx] : null;
    const vaultSelectedDoc = !vaultSelectedDocRaw ? null : {
      ...vaultSelectedDocRaw,
      standardsChips: (vaultSelectedDocRaw.linkedStandards||[]).map((s) => ({ label:s }))
    };
    const vaultOtherFolderLabel = vaultIsSpecFolder ? '' : (st.vaultActiveFolder + ' — full document listing not wired up in this demo; Specifications shows the complete flow.');

    const handoverPortalRowsRaw = [
      {
        key:'electrical', icon:'icon-clipboard', name:'QMP Inspect — Electrical Inspection & Testing', sub: clientData.project, packageId:'MER-JAGS-QI-001',
        statusLabel: st.handover ? 'Issued' : 'Not yet issued', statusCls: st.handover ? 'badge-green' : 'badge-grey',
        issueDate: st.handover ? '05 Sep 2026' : '—', canDownload: st.handover,
        canAcknowledge: st.handover && !st.handoverAcksByClient.electrical,
        acknowledgeFn: this.acknowledgeHandoverRow('electrical'),
        acknowledgedLabel: (st.handover && st.handoverAcksByClient.electrical) ? 'Acknowledged by Naveen Iyer — 06 Sep 2026' : ''
      },
      {
        key:'fat', icon:'icon-building', name:'FAT Services — Primary Crusher CR-201', sub:'Coastal LNG Terminal Ph.2', packageId:'MER-JAGS-FAT-004',
        statusLabel:'Acknowledged', statusCls:'badge-green', issueDate:'22 Aug 2026', canDownload:true,
        canAcknowledge:false, acknowledgeFn:null, acknowledgedLabel:'Acknowledged by Sarah Mitchell — 23 Aug 2026'
      },
      {
        key:'vendorSurveillance', icon:'icon-eye', name:'Vendor Surveillance — Switchgear Package', sub:'Coastal LNG Terminal Ph.2', packageId:'MER-JAGS-VS-011',
        statusLabel:'Ready', statusCls:'badge-blue', issueDate:'01 Sep 2026', canDownload:true,
        canAcknowledge:false, acknowledgeFn:null, acknowledgedLabel:''
      },
      {
        key:'qualityAudit', icon:'icon-shield', name:'Quality Audit — Contractor System Audit', sub:'Coastal LNG Terminal Ph.2', packageId:'MER-JAGS-AUD-007',
        statusLabel:'Awaiting final issue', statusCls:'badge-gold', issueDate:'Est. 12 Sep 2026', canDownload:false,
        canAcknowledge:false, acknowledgeFn:null, acknowledgedLabel:''
      },
      {
        key:'ncrCloseout', icon:'icon-file', name:'NCR Close-Out Dossier — Coastal LNG Terminal Ph.2', sub:'Coastal LNG Terminal Ph.2', packageId:'MER-JAGS-NCR-003',
        statusLabel:'Acknowledged', statusCls:'badge-green', issueDate:'18 Aug 2026', canDownload:true,
        canAcknowledge:false, acknowledgeFn:null, acknowledgedLabel:'Acknowledged by Michael Chen — 19 Aug 2026'
      },
      {
        key:'training', icon:'icon-book', name:'Training Records — Site Quality Induction', sub:'Coastal LNG Terminal Ph.2', packageId:'MER-JAGS-TRN-009',
        statusLabel:'Issued', statusCls:'badge-green', issueDate:'25 Aug 2026', canDownload:true,
        canAcknowledge: !st.handoverAcksByClient.training,
        acknowledgeFn: this.acknowledgeHandoverRow('training'),
        acknowledgedLabel: st.handoverAcksByClient.training ? 'Acknowledged by Naveen Iyer — Today' : ''
      }
    ];
    const handoverPortalRows = handoverPortalRowsRaw.map((r) => ({
      ...r,
      showAckButton: r.canAcknowledge,
      showAckLabel: !r.canAcknowledge && !!r.acknowledgedLabel,
      showAckDash: !r.canAcknowledge && !r.acknowledgedLabel,
      disabledDownload: !r.canDownload
    }));
    const handoverPortalReadyCount = handoverPortalRows.filter(r => r.canDownload).length;
    const handoverPortalAwaitingCount = handoverPortalRows.filter(r => r.canAcknowledge).length;
    const handoverPortalAckedCount = handoverPortalRows.filter(r => !!r.acknowledgedLabel).length;
    const handoverPortalStats = [
      { icon:'icon-briefcase', iconBg:'#f3dde1', iconColor:'#6B1E2C', n: String(handoverPortalRows.length), l:'Services' },
      { icon:'icon-upload', iconBg:'#dcefe1', iconColor:'#2f6f4e', n: String(handoverPortalReadyCount), l:'Ready for download' },
      { icon:'icon-clock', iconBg:'#fbeec2', iconColor:'#8a6a06', n: String(handoverPortalAwaitingCount), l:'Awaiting acknowledgement' },
      { icon:'icon-check', iconBg:'#dcefe1', iconColor:'#2f6f4e', n: String(handoverPortalAckedCount), l:'Fully acknowledged' }
    ];
    const handoverPortalActivity = [
      { date:'05 Sep 2026', text:'QMP Inspect — Electrical Inspection & Testing issued' + (st.handover ? '.' : ' (pending in this demo until the Handover Certificate is generated).') },
      { date:'01 Sep 2026', text:'Vendor Surveillance — Switchgear Package is ready for download.' },
      { date:'19 Aug 2026', text:'NCR Close-Out Dossier — Coastal LNG Terminal Ph.2 acknowledged by Michael Chen.' },
      { date:'23 Aug 2026', text:'FAT Services — Primary Crusher CR-201 acknowledged by Sarah Mitchell.' },
      { date:'12 Sep 2026', text:'Quality Audit — Contractor System Audit estimated issue date set.' }
    ];

    const activeClientPartyFlags = st.partyActiveByClient[st.activeClient];
    const partyKeyMap = { 'Contractor':'contractor', 'Subcontractor':'subcontractor', 'TPI / Lab':'tpi', 'Jags Assurance':'jags', 'Client':'client' };
    const settingsPartyRow = (ck, orgLabel) => (p) => {
      if (p.role === 'Jags Assurance') return null;
      const key = partyKeyMap[p.role];
      const active = key ? st.partyActiveByClient[ck][key] : true;
      return {
        name: p.contact, org: p.org, role: p.role,
        access: orgLabel + ' only' + (p.role === 'Client' ? ', own data' : ''),
        cls: active ? 'badge-green' : 'badge-grey',
        status: active ? 'Active' : 'Not required this project'
      };
    };
    const settingsAddedUserRows = st.clientAddedParties.map((p) => ({
      name: p.contact === 'TBC' ? p.org : p.contact, org: p.org, role: p.jobRole + ' (added by client)',
      access: 'Meridian Energy only, own data', cls: p.signed ? 'badge-green' : 'badge-gold',
      status: p.signed ? 'Active' : 'Pending sign-off'
    }));
    const settingsUserRows = [
      { name:'Priya Desai', org:'Jags Assurance', role:'Jags Admin / Quality Engineer', access:'All clients', cls:'badge-green', status:'Active' },
      { name:'Ravi Kapoor', org:'Jags Assurance', role:'Jags Inspector', access:'All clients', cls:'badge-green', status:'Active' },
      ...CLIENTS.meridian.parties.map(settingsPartyRow('meridian', 'Meridian Energy')).filter(Boolean),
      ...CLIENTS.northgate.parties.map(settingsPartyRow('northgate', 'Northgate Rail')).filter(Boolean),
      ...settingsAddedUserRows
    ];
    const setupPartyRows = clientData.parties.map((p) => {
      const key = partyKeyMap[p.role];
      const active = activeClientPartyFlags[key];
      return {
        role: p.role, org: p.org, chain: p.chain, contact: p.contact, email: p.email,
        active, statusLabel: active ? 'Active' : 'Not used on this project',
        statusCls: active ? 'badge-green' : 'badge-grey',
        toggleLabel: active ? 'Deactivate' : 'Activate',
        toggleFn: this.togglePartyActive(key)
      };
    });

    const isMeridianSample = st.activeClient==='meridian';
    const hwrCls = { H:'badge-burg', W:'badge-amber', R:'badge-blue', S:'badge-green' };
    const hwrRow = (n, activity, criteria, c, s, t, j, cl, rec, signed) => ({ n, activity, criteria, c, s, t, j, cl, rec, cCls:hwrCls[c], sCls:hwrCls[s], tCls:hwrCls[t], jCls:hwrCls[j], clCls:hwrCls[cl], signed: !!signed, signOffPending: !signed, signOffLabel: signed ? 'Signed off' : 'Pending' });
    const sigRow = (role, name, org, status, cls) => ({ role, name, org, status, cls });
    const sampleTabs = [['irn','IRN'],['itp','ITP'],['weekly','Weekly Report'],['databook','Data Book'],['ncrCert','NCR Close-Out'],['handover','Handover Cert.'],['inspectionA4','Inspection Report']].map(([k,label]) => ({
      key:k, label, cls: st.reportDocType===k ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm', go: this.setReportDocType(k)
    }));

    const sampleItp = isMeridianSample ? {
      docNo:'MER-JAGS-ITP-101', title:'Flooring & Screed — Inspection & Test Plan', discipline:'Civil',
      rev:'Rev 2', statusLabel:'Draft — 3/5 signed', statusCls:'badge-gold',
      issued:'2026-08-29', preparedBy:'Priya Desai, Jags Assurance',
      refs:'Reference: DRG-CIV-001 Rev 3 — Foundation Reinforcement Detail; SPEC-CIV-014 Rev 1 — Civil Concrete & Reinforcement Spec. AI-drafted from the Document Vault and reviewed by Priya Desai prior to issue. Rev 2 reflects an updated substrate spec — all parties are required to re-approve.',
      rows:[
        hwrRow(1,'Substrate prep & moisture test','Moisture ≤4% MC, substrate clean & sound','R','H','W','R','S','CHK-101-1',true),
        hwrRow(2,'Screed mix design & batching','Per approved mix design','R','H','R','R','S','CHK-101-2',true),
        hwrRow(3,'Screed laying & levelling','Level tolerance ±3mm / 3m','R','H','W','R','S','CHK-101-3',true),
        hwrRow(4,'Curing period verification','Min. 7-day cure, protected','R','R','R','R','S','CHK-101-4',true),
        hwrRow(5,'Floor finish / coating application','Per manufacturer spec, no visible defects','R','H','W','R','S','CHK-101-5',false),
        hwrRow(6,'Final flatness & thickness verification','FF/FL per spec, thickness ±2mm','R','R','H','H','S','CHK-101-6',false)
      ],
      sigs:[
        sigRow('Contractor','Marcus Tan','Trident Marine Construction','Signed · 09 Sep','badge-green'),
        sigRow('Subcontractor','Sofia Alvarez','BayShore Rebar Co.','Signed · 09 Sep','badge-green'),
        sigRow('TPI / Lab','Dr. Amara Rao','Apex Testing Labs','Pending','badge-gold'),
        sigRow('Jags Assurance','Priya Desai','Lead Inspector','Signed · 09 Sep','badge-green'),
        sigRow('Client','Naveen Iyer','Meridian Energy','Pending','badge-gold')
      ],
      partyCodesLegend:[
        {code:'C',label:'Contractor'},
        {code:'SC',label:'Subcontractor'},
        {code:'TPI',label:'Third-Party Inspector'},
        {code:'JA',label:'Jags Assurance'},
        {code:'CL',label:'Client'}
      ],
      pointTypesLegend:[
        {code:'H',label:'Hold point'},
        {code:'W',label:'Witness point'},
        {code:'R',label:'Review'},
        {code:'S',label:'Surveillance'}
      ],
      distributionList:[
        {org:'Jags Assurance',recipients:'Priya Desai, Ravi Kapoor',copy:'Master (Copy 1 of 5)',access:'Full — issuing authority'},
        {org:'Meridian Energy',recipients:'Naveen Iyer (Client Rep)',copy:'Copy 2 of 5',access:'View & client acceptance sign-off'},
        {org:'Trident Marine Construction',recipients:'Marcus Tan (Site Manager)',copy:'Copy 3 of 5',access:'View & contractor sign-off'},
        {org:'BayShore Rebar Co.',recipients:'Sofia Alvarez (QA Lead)',copy:'Copy 4 of 5',access:'View & subcontractor sign-off'},
        {org:'Apex Testing Labs',recipients:'Dr. Amara Rao (Lab Director)',copy:'Copy 5 of 5',access:'View & TPI witness sign-off'}
      ],
      approvals:[
        {role:'Prepared by',name:'Priya Desai',org:'Jags Assurance',date:'2026-08-29'},
        {role:'Reviewed by',name:'Priya Desai',org:'Jags Assurance',date:'2026-08-29'},
        {role:'Approved by',name:'Ravi Kapoor',org:'Jags Assurance',date:'2026-09-09'},
        {role:'Client Acceptance',name:'Naveen Iyer',org:'Meridian Energy',date:'Pending'}
      ]
    } : {
      docNo:'NGR-JAGS-ITP-004', title:'Signal Cable Termination — Inspection & Test Plan', discipline:'Signalling',
      rev:'Rev 2', statusLabel:'Draft — 2/5 signed', statusCls:'badge-gold',
      issued:'2026-09-09', preparedBy:'Priya Desai, Jags Assurance',
      refs:'Reference: SPEC-SIG-004 Rev 2 — Signal Cable Termination Spec; DRG-SIG-011 Rev 1 — Cable Route Section 3. AI-drafted from the Document Vault; awaiting Contractor, Subcontractor and Client sign-off to activate.',
      rows:[
        hwrRow(1,'Cable identification tags match schematic','Per approved schematic','H','R','W','R','S','CHK-004-4.2',false),
        hwrRow(2,'Termination torque within manufacturer spec','Per manufacturer torque spec','H','R','W','R','S','CHK-004-4.2',false),
        hwrRow(3,'Continuity test passed','Zero-ohm continuity confirmed','H','R','W','R','S','CHK-004-4.2',false),
        hwrRow(4,'Earth bonding continuity verified','Per SPEC-SIG-004','H','R','W','R','S','CHK-004-4.2',false)
      ],
      sigs:[
        sigRow('Contractor','Elena Osei','Ferrovia Rail Systems','Pending','badge-gold'),
        sigRow('Subcontractor','Tom Whitfield','SignalTech Installations','Pending','badge-gold'),
        sigRow('TPI / Lab','Priya Nair','Kestrel Test & Certification','Signed · Day 1, 10:15 AM','badge-green'),
        sigRow('Jags Assurance','Priya Desai / Ravi Kapoor','Jags Assurance','Signed · Day 1, 9:40 AM','badge-green'),
        sigRow('Client','Grace Okafor','Northgate Rail','Pending','badge-gold')
      ],
      partyCodesLegend:[
        {code:'C',label:'Contractor'},
        {code:'SC',label:'Subcontractor'},
        {code:'TPI',label:'Third-Party Inspector'},
        {code:'JA',label:'Jags Assurance'},
        {code:'CL',label:'Client'}
      ],
      pointTypesLegend:[
        {code:'H',label:'Hold point'},
        {code:'W',label:'Witness point'},
        {code:'R',label:'Review'},
        {code:'S',label:'Surveillance'}
      ],
      distributionList:[
        {org:'Jags Assurance',recipients:'Priya Desai, Ravi Kapoor',copy:'Master (Copy 1 of 5)',access:'Full — issuing authority'},
        {org:'Northgate Rail',recipients:'Grace Okafor (Client Rep)',copy:'Copy 2 of 5',access:'Pending — not yet distributed'},
        {org:'Ferrovia Rail Systems',recipients:'Elena Osei (Site Manager)',copy:'Copy 3 of 5',access:'Pending — not yet distributed'},
        {org:'SignalTech Installations',recipients:'Tom Whitfield (QA Lead)',copy:'Copy 4 of 5',access:'Pending — not yet distributed'},
        {org:'Kestrel Test & Certification',recipients:'Priya Nair (Lab Director)',copy:'Copy 5 of 5',access:'Pending — not yet distributed'}
      ],
      approvals:[
        {role:'Prepared by',name:'Priya Desai',org:'Jags Assurance',date:'2026-09-09'},
        {role:'Reviewed by',name:'Priya Desai',org:'Jags Assurance',date:'2026-09-09'},
        {role:'Approved by',name:'Ravi Kapoor',org:'Jags Assurance',date:'Pending'},
        {role:'Client Acceptance',name:'Grace Okafor',org:'Northgate Rail',date:'Pending'}
      ]
    };

    const sampleWeekly = isMeridianSample ? {
      docNo:'MER-JAGS-MQR-008', reportingPeriod:'August 2026',
      preparedFor:'Meridian Energy Holdings', confidentiality:'Client Confidential',
      contents:[
        {n:'01',label:'Executive summary'},
        {n:'02',label:'KPI performance'},
        {n:'03',label:'Progress by project'},
        {n:'04',label:'NCR summary'},
        {n:'05',label:'Vendor performance'},
        {n:'06',label:'Look-ahead & actions'}
      ],
      execSummary:'August 2026 saw solid quality performance across the Coastal LNG Terminal Expansion — Package 4 programme. First-time pass rate remains strong, and inspection throughput met plan. The number of open NCRs is within target, with timely closures supporting overall quality health. Data-book readiness continues to track ahead of schedule. Focus this month is on accelerating close-out of open NCRs and sustaining vendor performance into the next phase of construction and commissioning.',
      stats:[
        {n:'94.6%',l:'First-time pass rate'},
        {n:'146',l:'Inspections completed'},
        {n:'9',l:'Open NCRs'},
        {n:'94%',l:'Data-book readiness'}
      ],
      projectProgress:[
        {label:'Coastal LNG Terminal — Package 4', pct:78},
        {label:'North Jetty Upgrade', pct:64}
      ],
      ncrOpen:9, ncrClosed:29, ncrOpenArc:'24, 100',
      vendors:[
        {rank:1,name:'Apex Testing Labs',pct:'97%'},
        {rank:2,name:'Trident Marine Construction',pct:'94%'},
        {rank:3,name:'BayShore Rebar Co.',pct:'91%'}
      ],
      lookAhead:'Complete Column C-04 cover verification hold point and close remaining punch-list items ahead of Data Book closure. Progress Flooring ITP-101 into curing stage and begin document review for Ceiling & Partitions ITP-102. Continue tracking vendor performance and target full closure of open NCRs within the next reporting period.'
    } : {
      docNo:'NGR-JAGS-MQR-001', reportingPeriod:'September 2026',
      preparedFor:'Northgate Rail', confidentiality:'Client Confidential',
      contents:[
        {n:'01',label:'Executive summary'},
        {n:'02',label:'KPI performance'},
        {n:'03',label:'Progress by project'},
        {n:'04',label:'NCR summary'},
        {n:'05',label:'Vendor performance'},
        {n:'06',label:'Look-ahead & actions'}
      ],
      execSummary:'Signal Renewal Package 3 remains in mobilisation. NGR-JAGS-ITP-004 (Signal Cable Termination) has been drafted from Vault documents and reviewed internally; no field inspections have been executed yet, pending full ITP sign-off. No NCRs have been raised and no vendor performance history exists yet for this programme.',
      stats:[
        {n:'—',l:'First-time pass rate'},
        {n:'0',l:'Inspections completed'},
        {n:'0',l:'Open NCRs'},
        {n:'0%',l:'Data-book readiness'}
      ],
      projectProgress:[
        {label:'Signal Renewal Package 3', pct:8}
      ],
      ncrOpen:0, ncrClosed:0, ncrOpenArc:'0, 100',
      vendors:[
        {rank:1,name:'Kestrel Test & Certification',pct:'—'},
        {rank:2,name:'Ferrovia Rail Systems',pct:'—'},
        {rank:3,name:'SignalTech Installations',pct:'—'}
      ],
      lookAhead:'Obtain Contractor (Ferrovia Rail Systems), Subcontractor (SignalTech Installations) and Client (Northgate Rail — Grace Okafor) sign-off to activate ITP-004; schedule the first witnessed inspection on Cable Route Section 3.'
    };

    const sampleDatabook = isMeridianSample ? {
      docNo:'MER-JAGS-DBK-001', asOf:'13 Sep 2026', pct:'92%', statusLabel:'In progress — 1 blocker', statusCls:'badge-gold',
      rows:[
        {n:1,section:'Project Setup & Scope',records:'Contract, ITP Register, Party Assignment Log',statusLabel:'Complete',cls:'badge-green'},
        {n:2,section:'ITP-001 Civil (Reinforcement)',records:'CHK-001, Contractor Review, TPI Witness Record, IRN-001',statusLabel:'Complete',cls:'badge-green'},
        {n:3,section:'ITP-101 Flooring & Screed (Rev 2)',records:'CHK-101-1–6, Sign-off Record',statusLabel:'3/5 signed',cls:'badge-gold'},
        {n:4,section:'Non-Conformance Register',records:'MER-NCR-2026-001 (Major — pending client ack)',statusLabel:'Blocked',cls:'badge-burg'},
        {n:5,section:'Live Registers Extract',records:'Calibration, Welder Qualification, Material Registers',statusLabel:'Complete',cls:'badge-green'},
        {n:6,section:'Punch-List Record',records:'2 open / 1 closed as of report date',statusLabel:'Open items',cls:'badge-gold'},
        {n:7,section:'Handover Certificate',records:'Not yet issued',statusLabel:'Pending',cls:'badge-grey'}
      ],
      blocked:true, blockText:'Data Book cannot close until Meridian Energy independently acknowledges MER-NCR-2026-001 (ISO 17020 impartiality requirement) and the two remaining punch-list items are closed.'
    } : {
      docNo:'NGR-JAGS-DBK-001', asOf:'—', pct:'0%', statusLabel:'Not started', statusCls:'badge-grey',
      rows:[
        {n:1,section:'Project Setup & Scope',records:'Contract, ITP Register, Party Assignment Log',statusLabel:'Complete',cls:'badge-green'},
        {n:2,section:'ITP-004 Signalling (Cable Termination)',records:'CHK-004-4.2, Sign-off Record',statusLabel:'2/5 signed',cls:'badge-gold'},
        {n:3,section:'Non-Conformance Register',records:'—',statusLabel:'No records yet',cls:'badge-grey'},
        {n:4,section:'Live Registers Extract',records:'—',statusLabel:'No records yet',cls:'badge-grey'},
        {n:5,section:'Handover Certificate',records:'Not yet issued',statusLabel:'Pending',cls:'badge-grey'}
      ],
      blocked:true, blockText:'Not yet active — this Data Book populates automatically once ITP-004 is fully signed and field inspections begin. Structure shown above for reference.'
    };

    const sampleHandover = isMeridianSample ? {
      docNo:'MER-JAGS-HOC-001', ready:true, issued:'Issued 20 Sep 2026',
      note:'This is to certify that the Quality Management Programme for the above project has been executed and independently verified complete by Jags Assurance, in accordance with the approved Inspection & Test Plans, and that all associated records form part of Data Book MER-JAGS-DBK-001.',
      scope:'Civil (Reinforcement, Flooring & Screed), Electrical Fit-out — Tank Farm North & South, Pipe Rack Section 14.',
      sigs:[
        sigRow('Contractor','Marcus Tan','Trident Marine Construction','Signed','badge-green'),
        sigRow('Subcontractor','Sofia Alvarez','BayShore Rebar Co.','Signed','badge-green'),
        sigRow('TPI / Lab','Dr. Amara Rao','Apex Testing Labs','Signed','badge-green'),
        sigRow('Jags Assurance','Priya Desai','Lead Inspector','Signed','badge-green'),
        sigRow('Client','Naveen Iyer','Meridian Energy','Signed','badge-green')
      ]
    } : {
      docNo:'NGR-JAGS-HOC-001', ready:false, issued:'Issued at project completion',
      note:'This certificate is issued automatically once Data Book NGR-JAGS-DBK-001 reaches 100% completeness for Signal Renewal Package 3. Preview shown below with sample fields.',
      scope:'Not yet applicable — scope will be confirmed at handover.',
      sigs:[
        sigRow('Contractor','Elena Osei','Ferrovia Rail Systems','Not yet due','badge-grey'),
        sigRow('Subcontractor','Tom Whitfield','SignalTech Installations','Not yet due','badge-grey'),
        sigRow('TPI / Lab','Priya Nair','Kestrel Test & Certification','Not yet due','badge-grey'),
        sigRow('Jags Assurance','Priya Desai / Ravi Kapoor','Jags Assurance','Not yet due','badge-grey'),
        sigRow('Client','Grace Okafor','Northgate Rail','Not yet due','badge-grey')
      ]
    };

    const sampleIrn = isMeridianSample ? {
      docNo:'MER-JAGS-IRN-001', ready: st.result==='pass',
      activity:'Activity 2.1 — Reinforcement Inspection', location:'Foundation F-001', ref:'DRG-CIV-001 Rev 3',
      resultLabel: st.result==='pass' ? 'Pass — Released' : (st.result==='fail' ? 'Failed — Not Released' : 'Pending Result'),
      resultCls: st.result==='pass' ? 'badge-green' : (st.result==='fail' ? 'badge-burg' : 'badge-grey'),
      note:'This notice releases the above activity for the next stage of works, confirming the inspection was witnessed and found acceptable against the referenced drawing and specification.',
      sigs:[
        sigRow('Jags Assurance','Priya Desai','Lead Inspector', st.result==='pass' ? 'Signed' : 'Pending', st.result==='pass' ? 'badge-green' : 'badge-gold'),
        sigRow('TPI / Lab','Dr. Amara Rao','Apex Testing Labs', st.result==='pass' ? 'Signed' : 'Pending', st.result==='pass' ? 'badge-green' : 'badge-gold')
      ]
    } : {
      docNo:'NGR-JAGS-IRN-001', ready:false,
      activity:'Activity 4.2 — Signal Cable Termination Inspection', location:'Section 3 Cable Route', ref:'DRG-SIG-011 Rev 1',
      resultLabel:'Not yet inspected', resultCls:'badge-grey',
      note:'No inspection has been executed on Signal Renewal Package 3 yet. An Inspection Release Notice is generated automatically the first time a witnessed activity passes.',
      sigs:[
        sigRow('Jags Assurance','Priya Desai / Ravi Kapoor','Jags Assurance','Not yet due','badge-grey'),
        sigRow('TPI / Lab','Priya Nair','Kestrel Test & Certification','Not yet due','badge-grey')
      ]
    };

    const sampleNcrCert = isMeridianSample ? {
      docNo:'MER-JAGS-NCC-001', ready:true, issued:'Issued on independent client acknowledgement',
      ncrNo:'MER-NCR-2026-001', severityLabel:'Major NCR', severityCls:'badge-burg',
      note:'This certifies that MER-NCR-2026-001 (rebar cover deviation, Foundation F-001), raised against Trident Marine Construction, has completed its full corrective-action cycle — containment, root cause and verification — and is closed out in accordance with the approved Quality Management Programme.',
      steps:[
        { label:'Raised', detail:'Cover block spacing exceeds tolerance, Foundation F-001', cls:'badge-green' },
        { label:'Containment', detail:'Affected area isolated pending rework', cls:'badge-green' },
        { label:'Root Cause', detail:'Incorrect spacer selection during placement', cls:'badge-green' },
        { label:'Corrective Action Verified', detail:'Re-inspected and verified by Jags Assurance', cls:'badge-green' },
        { label:'Client Acknowledgement', detail:'Independent sign-off per ISO 17020 impartiality requirement', cls:'badge-gold' }
      ],
      sigs:[
        sigRow('Contractor','Marcus Tan','Trident Marine Construction','Signed','badge-green'),
        sigRow('Jags Assurance','Priya Desai','Lead Inspector','Signed','badge-green'),
        sigRow('Client','Naveen Iyer','Meridian Energy','Pending','badge-gold')
      ],
      trace:{ project:'Coastal LNG Terminal Ph.2', client:'Meridian Energy', itpRef:'MER-JAGS-ITP-001', location:'Foundation F-001', drawingRev:'DRG-CIV-001 Rev 3', dateIssued:'2026-08-18', ncrType:'Major NCR', issuedBy:'Priya Desai — Lead Inspector' },
      rcca:{
        rootCause:'Incorrect spacer selection during placement led to cover block spacing exceeding the tolerance specified in the approved drawing.',
        correctiveAction:'Affected reinforcement re-worked with correct spacer type and re-inspected against DRG-CIV-001 Rev 3 before concrete pour proceeded.',
        preventiveAction:'Toolbox talk delivered to the placement crew on spacer selection; an additional hold point added to the ITP before pour approval.',
        verification:'Follow-up inspection by Jags Assurance confirmed all cover blocks meet the required spacing. No similar non-conformances observed since.'
      },
      closureNote:'The above corrective and preventive actions have been completed and verified as effective. This NCR is hereby closed.',
      closureVerifiedBy:'Priya Desai — Jags Assurance', closureVerifiedDate:'2026-08-22'
    } : {
      docNo:'NGR-JAGS-NCC-001', ready:false, issued:'Issued when an NCR is raised and closed',
      ncrNo:'—', severityLabel:'No NCRs raised', severityCls:'badge-grey',
      note:'No non-conformances have been raised on Signal Renewal Package 3 yet. A Close-Out Certificate is generated automatically the first time an NCR completes its corrective-action cycle.',
      steps:[
        { label:'Raised', detail:'—', cls:'badge-grey' },
        { label:'Containment', detail:'—', cls:'badge-grey' },
        { label:'Root Cause', detail:'—', cls:'badge-grey' },
        { label:'Corrective Action Verified', detail:'—', cls:'badge-grey' },
        { label:'Client Acknowledgement', detail:'—', cls:'badge-grey' }
      ],
      sigs:[
        sigRow('Contractor','Elena Osei','Ferrovia Rail Systems','Not yet due','badge-grey'),
        sigRow('Jags Assurance','Priya Desai / Ravi Kapoor','Jags Assurance','Not yet due','badge-grey'),
        sigRow('Client','Grace Okafor','Northgate Rail','Not yet due','badge-grey')
      ],
      trace:{ project:'Signal Renewal Package 3', client:'Northgate Rail', itpRef:'—', location:'—', drawingRev:'—', dateIssued:'—', ncrType:'—', issuedBy:'—' },
      rcca:{ rootCause:'—', correctiveAction:'—', preventiveAction:'—', verification:'—' },
      closureNote:'', closureVerifiedBy:'—', closureVerifiedDate:'—'
    };

    const aiGenDocsDefs = [
      { name: clientData.activity.ref + ' (Specification)', size: '4.2 MB' },
      { name: 'DRG-CIV-001 — Foundation Reinforcement Detail (Rev 3)', size: '1.8 MB' }
    ];
    const aiGenDocs = aiGenDocsDefs.map((d, i) => {
      const attached = st.aiGenDocsAttached[i];
      return { name: d.name, size: d.size, attached, cls: attached ? 'badge-green' : 'badge-grey', label: attached ? 'Attached' : 'Not attached', toggle: this.toggleAiGenDoc(i) };
    });
    const aiGenAttachedCount = st.aiGenDocsAttached.filter(Boolean).length;
    const aiGenNotReady = !st.aiGenDocsAttached.every(Boolean);
    const aiGenStageDefs = ['Reading specification document','Extracting inspection activities & sections','Mapping H/W/R/S per party','Drafting ITP sections for review'];
    const aiGenStages = aiGenStageDefs.map((text, i) => {
      const done = st.aiGenProgress > i;
      const active = st.aiGenProgress === i;
      return { text, cls: done ? 'badge-green' : (active ? 'badge-gold' : 'badge-grey'), label: done ? 'Done' : (active ? 'Working…' : 'Queued') };
    });

    const activeItpPackage = st.itpPackages[st.activeItpPackageIdx] || st.itpPackages[0];
    const pkgVaultDocPool = [
      ...clientData.vaultDocs.map(d => ({ name: d.name, size: d.size })),
      ...st.clientUploadedDocs.map(d => ({ name: d.name + ' (' + d.category + ')', size: '—' }))
    ];
    const pkgAttachedDocs = activeItpPackage.attachedDocs || [];
    const pkgDocs = pkgVaultDocPool.map(d => {
      const attached = pkgAttachedDocs.includes(d.name);
      return { name: d.name, size: d.size, attached, cls: attached ? 'badge-green' : 'badge-grey', label: attached ? 'Attached' : 'Not attached', toggle: this.toggleItpPackageDoc(d.name) };
    });
    const pkgNotReady = pkgAttachedDocs.length === 0;
    const pkgIsRevision = activeItpPackage.everBuilt;
    const pkgGenerateBtnLabel = pkgIsRevision ? ('Regenerate ' + activeItpPackage.name + ' with AI →') : ('Generate ' + activeItpPackage.name + ' with AI →');
    const pkgStageDefs = ['Reading ' + activeItpPackage.discipline + ' specification', 'Extracting inspection activities for ' + activeItpPackage.name, 'Mapping H/W/R/S per assigned party', 'Drafting ITP sections for review'];
    const pkgStages = pkgStageDefs.map((text, i) => {
      const done = activeItpPackage.progress > i;
      const active = activeItpPackage.progress === i;
      return { text, cls: done ? 'badge-green' : (active ? 'badge-gold' : 'badge-grey'), label: done ? 'Done' : (active ? 'Working…' : 'Queued') };
    });
    const pkgSectionCount = 5;
    const pkgRequirementExplainer = 'A ' + activeItpPackage.discipline + ' ITP for ' + activeItpPackage.name + ' typically draws on a Drawing, a Specification, and (where relevant) a Method Statement — attach whatever is already in the Vault below; you can add more documents and regenerate at any time, even after this ITP has been approved.';

    const pkgStatusLabelMap = { not_started:'Not started', attach:'Attaching docs', processing:'AI drafting…', review:'Ready for review', built:'Draft — awaiting sign-off', approved:'Fully approved' };
    const pkgStatusClsMap = { not_started:'badge-grey', attach:'badge-blue', processing:'badge-blue', review:'badge-blue', built:'badge-gold', approved:'badge-green' };
    const meridianPartyFlags = st.partyActiveByClient.meridian;
    const activePkgSignKeys = signKeys.filter(([party, key]) => key === 'subcontractor' || meridianPartyFlags[key]);
    const activePkgRequiredKeys = activePkgSignKeys.map(([, key]) => key);
    const meridianAssignmentSignKeys = ['contractor', 'tpi', 'jags', 'client'].filter((key) => meridianPartyFlags[key]);
    const itpPackageRows = st.itpPackages.map((pkg, idx) => {
      const canOpenGen = st.role==='admin' || (st.role==='client' && clientPersonaSelfService);
      const genLabel = pkg.everBuilt ? 'Add Docs / Regenerate' : 'Generate with AI →';
      const signRowsForPkg = activePkgSignKeys.map(([party, key]) => {
        const val = pkg.sign[key];
        const org = key==='subcontractor' ? pkg.subcontractorOrg : clientData.signOrgs[key];
        return { party, org, label: val ? ('Signed · ' + val) : 'Pending', cls: val ? 'badge-green' : 'badge-gold',
          canSign: !val && (pkg.status==='built' || pkg.status==='approved'), signFn: this.signPackageParty(idx, key, party, org, activePkgRequiredKeys) };
      });
      const signedCount = activePkgSignKeys.filter(([party, key]) => pkg.sign[key]).length;
      const assignedPartiesText = parties.map(p => p.role==='Subcontractor' ? pkg.subcontractorOrg : p.org).join(', ');
      return {
        idx, name: pkg.name, discipline: pkg.discipline, itpNumber: pkg.itpNumber, revision: pkg.revision || 1,
        statusLabel: pkgStatusLabelMap[pkg.status], statusCls: pkgStatusClsMap[pkg.status],
        signedCount, totalSlots: activePkgSignKeys.length,
        canOpenGen, genLabel, openGen: this.openItpPackage(idx),
        docCount: (pkg.attachedDocs || []).length,
        expanded: st.expandedPackageIdx === idx, toggleExpand: this.togglePackageExpand(idx),
        toggleLabel: st.expandedPackageIdx === idx ? 'Hide Sign-offs' : 'View Sign-offs',
        signRows: signRowsForPkg,
        assignedPartiesText
      };
    });
    const itpPackagesBuiltCount = st.itpPackages.filter(p => p.status==='built' || p.status==='approved').length;
    const isMeridianClient = st.activeClient==='meridian';
    const resolveItpNumber = (numberingTemplate) => numberingTemplate.itp.replace('{SEQ}', '001');
    const meridianItpNumber = resolveItpNumber(CLIENTS.meridian.numbering);
    const northgateItpNumber = resolveItpNumber(CLIENTS.northgate.numbering);
    // ---- ITP Register (admin) — search/filter/actions ----
    const onItpRegisterSearch = this.setItpRegisterSearch();
    const onItpRegisterProjectFilter = this.setItpRegisterProjectFilter();
    const onItpRegisterDisciplineFilter = this.setItpRegisterDisciplineFilter();
    const onItpRegisterStatusFilter = this.setItpRegisterStatusFilter();
    const clearItpRegisterFilters = this.clearItpRegisterFilters();
    const itpRegisterNoop = this.itpRegisterNoop();
    const itpRegisterAllRows = [
      {
        idx: 0,
        itpNumber: meridianItpNumber,
        project: 'Coastal LNG Terminal Ph.2',
        client: 'Meridian Energy',
        discipline: 'Civil',
        revision: 'Rev 2',
        statusLabel: 'Draft — ' + signedCount + '/' + totalSignSlots + ' signed',
        statusWord: 'Draft',
        statusCls: 'badge-gold',
        pct: meridianItpPct,
        openItems: registerMeridianOpen,
        updated: '20 May 2025 · 10:24',
        menuOpen: st.itpRegisterOpenMenuIdx === 0,
        toggleMenu: this.toggleItpRegisterRowMenu(0)
      },
      {
        idx: 1,
        itpNumber: northgateItpNumber,
        project: 'Signal Renewal Package 3',
        client: 'Northgate Rail',
        discipline: 'Signalling',
        revision: 'Rev 2',
        statusLabel: 'Draft — ' + northgateSignedCount + '/' + northgateTotalSlots + ' signed',
        statusWord: 'Draft',
        statusCls: 'badge-gold',
        pct: northgateItpPct,
        openItems: northgateOpenText,
        updated: '19 May 2025 · 15:41',
        menuOpen: st.itpRegisterOpenMenuIdx === 1,
        toggleMenu: this.toggleItpRegisterRowMenu(1)
      }
    ];
    const itpRegisterSearchLower = (st.itpRegisterSearch || '').trim().toLowerCase();
    const itpRegisterFilteredRows = itpRegisterAllRows.filter(r => {
      const matchesSearch = !itpRegisterSearchLower || (r.itpNumber + ' ' + r.project).toLowerCase().includes(itpRegisterSearchLower);
      const matchesProject = st.itpRegisterProjectFilter === 'all' || r.project === st.itpRegisterProjectFilter;
      const matchesDiscipline = st.itpRegisterDisciplineFilter === 'all' || r.discipline === st.itpRegisterDisciplineFilter;
      const matchesStatus = st.itpRegisterStatusFilter === 'all' || r.statusWord === st.itpRegisterStatusFilter;
      return matchesSearch && matchesProject && matchesDiscipline && matchesStatus;
    });
    const itpRegisterFilterOptions = {
      projects: itpRegisterAllRows.map(r => r.project).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      disciplines: itpRegisterAllRows.map(r => r.discipline).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      statuses: itpRegisterAllRows.map(r => r.statusWord).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label }))
    };
    const itpRegisterCountLabel = itpRegisterFilteredRows.length === 0
      ? ('Showing 0 of ' + itpRegisterAllRows.length)
      : ('Showing 1' + (itpRegisterFilteredRows.length > 1 ? ('–' + itpRegisterFilteredRows.length) : '') + ' of ' + itpRegisterAllRows.length);
    const itpNumber = resolveItpNumber(clientData.numbering);
    const activePartiesCount = clientData.parties.length + (isMeridianClient ? st.clientAddedParties.length : 0);
    const otherClientKey = st.activeClient==='meridian' ? 'northgate' : 'meridian';
    const otherClientOrg = CLIENTS[otherClientKey].org;
    const switchClient = () => this.setState({ activeClient: otherClientKey });
    const openIrnDoc = () => this.setState({ screen:'sampleDocs', reportDocType:'irn' });
    const openNcrCertDoc = () => this.setState({ screen:'sampleDocs', reportDocType:'ncrCert' });
    const openDatabookDoc = () => this.setState({ screen:'sampleDocs', reportDocType:'databook' });
    const openHandoverDoc = () => this.setState({ screen:'sampleDocs', reportDocType:'handover' });
    const openMonthlyPackDoc = () => this.setState({ screen:'sampleDocs', reportDocType:'weekly' });
    const goReportsScreen = () => this.setState({ screen:'reports' });
    const serviceIsCivil = st.activeService==='civil';
    const serviceIsElectrical = st.activeService==='electrical';
    const elecItpNumber = resolveItpNumber({ itp: 'MER-JAGS-ITP-{SEQ}' }).replace('001','002');
    const switchToCivil = () => this.setState({ activeService: 'civil' });
    const switchToElectrical = () => this.setState({ activeService: 'electrical', log: this.appendLog('Naveen Iyer opened the Electrical QA service (ITP Development).') });
    const clientServices = [
      { key:'civil', name:'Civil QA', sub:'Reinforcement, concrete & structural inspection', statusLabel:'In Progress', cls:'badge-gold', activeLabel: serviceIsCivil ? 'Viewing' : 'Open', go: switchToCivil },
      { key:'electrical', name:'Electrical QA', sub:'Cable termination & switchgear inspection', statusLabel:'ITP Development', cls:'badge-blue', activeLabel: serviceIsElectrical ? 'Viewing' : 'Open', go: switchToElectrical }
    ];
    const breadcrumbOrg = st.role==='admin' ? clientData.org : 'Meridian Energy';
    const breadcrumbProject = st.role==='admin' ? clientData.project : ('Coastal LNG Terminal Ph.2 — ' + (serviceIsElectrical ? 'Electrical QA' : 'Civil QA'));
    const noop = () => {};
    const breadcrumbOrgClick = st.role==='admin' ? this.openClientWorkspace(st.activeClient) : noop;
    const breadcrumbProjectClick = st.role==='admin' ? this.openProjectControl() : noop;

    const approvalActiveSign = st[clientData.signStateField];
    const approvalActiveSignKeys = signKeys.filter(([party,key]) => activeClientPartyFlags[key]);
    const approvalBaseRows = approvalActiveSignKeys.map(([party,key]) => {
      const val = approvalActiveSign[key];
      const clientSignsElsewhere = isSelfService && key==='client' && st.activeClient==='meridian';
      return {
        party, org: clientData.signOrgs[key],
        label: val ? ('Signed · ' + val) : (clientSignsElsewhere ? 'Signs from their own portal' : 'Pending'),
        cls: val ? 'badge-green' : (clientSignsElsewhere ? 'badge-blue' : 'badge-gold'),
        canSign: !val && !clientSignsElsewhere, signFn: this.signPartyGeneric(clientData.signStateField, key, party, clientData.signOrgs[key])
      };
    });
    const approvalClientAddedRows = isMeridianClient ? st.clientAddedParties.map((p, i) => ({
      party: p.org, org: p.org,
      label: p.signed ? ('Signed · ' + p.signed) : 'Pending', cls: p.signed ? 'badge-green' : 'badge-gold',
      canSign: !p.signed, signFn: this.signAddedParty(i)
    })) : [];
    const approvalSignRows = [...approvalBaseRows, ...approvalClientAddedRows];
    const approvalTotalSlots = approvalActiveSignKeys.length + (isMeridianClient ? st.clientAddedParties.length : 0);
    const approvalSignedCount = approvalActiveSignKeys.filter(([party,key]) => approvalActiveSign[key]).length + (isMeridianClient ? st.clientAddedParties.filter(p=>p.signed).length : 0);
    const approvalAllSigned = approvalSignedCount === approvalTotalSlots;
    const approvalNotAllSigned = !approvalAllSigned;

    const myPartyKeyMap = { admin:'jags', inspector:'jags', contractor:'contractor', sub:'subcontractor', tpi:'tpi', client:'client' };
    const myPartyKey = myPartyKeyMap[st.role];
    const isJagsRole = st.role==='admin' || st.role==='inspector';
    const centreClientKeys = isJagsRole ? ['meridian','northgate'] : ['meridian'];
    const openClientApproval = (ck) => () => this.setState({ activeClient: ck, role:'admin', screen:'approval' });
    const allApprovalRows = [];
    centreClientKeys.forEach((ck) => {
      const cd = CLIENTS[ck];
      const activeSign = st[cd.signStateField];
      const itpNum = resolveItpNumber(cd.numbering);
      const selfServiceForClient = st.engagementModeByClient[ck] !== 'managed';
      signKeys.filter(([party, key]) => st.partyActiveByClient[ck][key]).forEach(([party, key]) => {
        const val = activeSign[key];
        const clientSignsElsewhere = ck==='meridian' && selfServiceForClient && key==='client';
        const mine = key === myPartyKey;
        allApprovalRows.push({
          id: ck + '_' + key,
          itpNumber: itpNum, client: cd.org, project: cd.project, party,
          status: val ? ('Signed · ' + val) : (clientSignsElsewhere ? 'Signs from their own portal' : 'Pending'),
          cls: val ? 'badge-green' : (clientSignsElsewhere ? 'badge-blue' : 'badge-gold'),
          signed: !!val, mine, canSign: mine && !val && !clientSignsElsewhere,
          signFn: this.signPartyGeneric(cd.signStateField, key, party, cd.signOrgs[key]),
          go: openClientApproval(ck)
        });
      });
      if (ck === 'meridian') {
        st.clientAddedParties.forEach((p, i) => {
          allApprovalRows.push({
            id: 'meridian_added_' + i,
            itpNumber: itpNum, client: cd.org, project: cd.project, party: p.org,
            status: p.signed ? ('Signed · ' + p.signed) : 'Pending',
            cls: p.signed ? 'badge-green' : 'badge-gold',
            signed: !!p.signed, mine: st.role === 'client', canSign: st.role === 'client' && !p.signed,
            signFn: this.signAddedParty(i),
            go: openClientApproval(ck)
          });
        });
        const assignmentPartyLabelsShort = { contractor:'Contractor', tpi:'TPI / Lab', jags:'Jags Assurance', client:'Client' };
        const noOpGo = () => {};
        st.assignments.forEach((a, ai) => {
          ['contractor','tpi','jags','client'].filter((key) => st.partyActiveByClient[ck][key]).forEach((key) => {
            const val = a.sign[key];
            const mine = key === myPartyKey;
            allApprovalRows.push({
              id: 'assignment_' + ai + '_' + key,
              itpNumber: a.number, client: cd.org, project: a.title, party: assignmentPartyLabelsShort[key],
              status: val ? 'Signed' : 'Pending',
              cls: val ? 'badge-green' : 'badge-gold',
              signed: !!val, mine, canSign: mine && !val,
              signFn: this.signAssignmentPartyFor(ai, key),
              go: noOpGo
            });
          });
        });
        st.itpPackages.forEach((pkg, pi) => {
          const val = pkg.sign.contractor;
          const mine = myPartyKey === 'contractor';
          allApprovalRows.push({
            id: 'package_' + pi + '_contractor',
            itpNumber: pkg.itpNumber, client: cd.org, project: pkg.name, party: 'Contractor',
            status: val ? ('Signed · ' + val) : 'Pending',
            cls: val ? 'badge-green' : 'badge-gold',
            signed: !!val, mine, canSign: mine && !val && (pkg.status==='built' || pkg.status==='approved'),
            signFn: this.signPackageParty(pi, 'contractor', 'Contractor', cd.signOrgs.contractor, activePkgRequiredKeys),
            go: noOpGo
          });
        });
      }
    });
    const needsMyApprovalItp = allApprovalRows.filter(r => r.canSign);
    const waitingOnOthers = allApprovalRows.filter(r => !r.signed && !r.mine);
    const waitingOnOthersEmpty = waitingOnOthers.length === 0;
    const approvalHistory = allApprovalRows.filter(r => r.signed);
    const approvalHistoryEmpty = approvalHistory.length === 0;
    const openApprovalsCentre = () => this.setState({ screen:'approvalsCentre' });

    const fieldAnswers = st.fieldAnswers;
    const fieldChecklist = checklistItems.map((c,i) => {
      const a = fieldAnswers[i];
      return {
        text: c.text,
        yesCls: a.status==='yes' ? 'on-yes' : '', noCls: a.status==='no' ? 'on-no' : '', naCls: a.status==='na' ? 'on-na' : '',
        isNo: a.status==='no', comment: a.comment,
        hasMeasured: !!c.measured, measuredValue: c.measured || '',
        setYes: () => this.setFieldAnswer(i,'yes'), setNo: () => this.setFieldAnswer(i,'no'), setNa: () => this.setFieldAnswer(i,'na'),
        onComment: (e) => this.setFieldComment(i, e.target.value)
      };
    });
    const answerLabelMap = { yes:'Yes', no:'No', na:'N/A', unset:'Not answered' };
    const answerClsMap = { yes:'badge-green', no:'badge-burg', na:'badge-grey', unset:'badge-grey' };
    const reviewChecklist = checklistItems.map((c,i) => {
      const a = fieldAnswers[i];
      return { n:c.n, text:c.text, answerLabel: answerLabelMap[a.status], answerCls: answerClsMap[a.status], comment:a.comment, hasComment: a.comment.trim()!=='' };
    });
    const fieldAnsweredCount = fieldAnswers.filter(a => a.status!=='unset').length;
    const fieldHasFail = fieldAnswers.some(a => a.status==='no');
    const flaggedIdx = fieldAnswers.findIndex(a => a.status==='no');
    const flaggedText = flaggedIdx>=0 ? checklistItems[flaggedIdx].text : '';
    const flaggedComment = flaggedIdx>=0 ? (fieldAnswers[flaggedIdx].comment || '(no comment given)') : '';
    const flaggedDescription = flaggedIdx>=0
      ? (checklistItems[flaggedIdx].text + ' — ' + (fieldAnswers[flaggedIdx].comment || 'no further comment on file') + '.')
      : 'Cover block spacing exceeds 900 mm max per DRG-CIV-001 Rev 3.';
    const fieldPhotosLabel = st.fieldPhotos + (st.fieldPhotos===1 ? ' photo attached' : ' photos attached');
    const fieldSignedLabel = st.fieldSigned ? 'signed by S. Alvarez' : 'not yet signed';
    const fieldAllAnswered = fieldAnswers.every(a => a.status!=='unset' && (a.status!=='no' || a.comment.trim()!==''));
    const fieldNotComplete = !(fieldAllAnswered && st.fieldPhotos>0 && st.fieldSigned);
    const signedCls = st.fieldSigned ? 'done' : '';
    const sigLineText = st.fieldSigned ? 'Signed — S. Alvarez' : 'Tap to sign — S. Alvarez';

    const fieldSpecDoc = (clientData.vaultDocs || []).find(d => /^SPEC/.test(d.name));
    const fieldSpecLabel = fieldSpecDoc ? (fieldSpecDoc.name.split(' — ')[1] || fieldSpecDoc.name) + ' ' + fieldSpecDoc.rev : clientData.activity.criteria;
    const fieldTraceability = {
      project: clientData.project, client: clientData.org,
      itpRef: itpNumber + ' / Activity ' + clientData.activity.num,
      location: clientData.activity.location, drawingRev: clientData.activity.ref,
      spec: fieldSpecLabel, date: '07 Sep 2026', inspector: 'S. Alvarez'
    };
    const fieldYesCount = fieldAnswers.filter(a => a.status==='yes').length;
    const fieldNoCount = fieldAnswers.filter(a => a.status==='no').length;
    const fieldNaCount = fieldAnswers.filter(a => a.status==='na').length;
    const fieldOverallResult = {
      statusLabel: fieldHasFail ? 'FAIL' : 'PASS', statusCls: fieldHasFail ? 'badge-burg' : 'badge-green',
      overallCls: fieldHasFail ? 'fail' : 'pass',
      yesCount: fieldYesCount, noCount: fieldNoCount, naCount: fieldNaCount
    };
    const clientWitnessName = st.clientWitnessName;
    const onClientWitnessName = this.onClientWitnessName();

    const subLabel = st.subSubmitted ? 'Submitted' : 'Pending'; const subCls = st.subSubmitted ? 'badge-green' : 'badge-gold';
    const contractorLabel = st.contractorApproved ? 'Approved' : (st.subSubmitted ? 'Ready to review' : 'Waiting on Sub');
    const contractorCls = st.contractorApproved ? 'badge-green' : (st.subSubmitted ? 'badge-gold' : 'badge-grey');
    const tpiLabel = st.tpiUploaded ? 'Uploaded' : 'Pending'; const tpiCls = st.tpiUploaded ? 'badge-green' : 'badge-gold';
    const witnessLabelMap = { pending:'Pending', attended:'Attended', waived:'Waived' };
    const witnessLabel = witnessLabelMap[st.witness]; const witnessCls = st.witness==='pending' ? 'badge-gold' : 'badge-green';

    const canInspect = st.subSubmitted && st.contractorApproved && st.tpiUploaded && st.witness!=='pending';
    const missing = [];
    if (!st.subSubmitted) missing.push('Subcontractor checklist');
    if (!st.contractorApproved) missing.push('Contractor review');
    if (!st.tpiUploaded) missing.push('TPI / Lab report');
    if (st.witness==='pending') missing.push('Client witness');
    const missingText = missing.join(', ');

    const queueLabel = canInspect ? 'Ready to inspect' : 'In progress'; const queueCls = canInspect ? 'badge-green' : 'badge-gold';

    const inspectorKpis = [
      { n:'12', l:'Active projects', sub:'3 require attention' },
      { n:'28', l:'Active ITPs', sub:'6 updated this week' },
      { n:'9', l:'Pending inspections', sub:'3 due today' },
      { n:'4', l:'Overdue hold points', sub:'Oldest: 3 days' }
    ];
    const inspActivityRow = {
      priority:'High', priorityCls:'badge-red', activity:'2.1 Reinforcement Inspection', project:'Coastal LNG Terminal / Civil',
      due:'Today', dueSoon:true, statusLabel: queueLabel, statusCls: queueCls,
      actionLabel: canInspect ? 'Start' : 'Open', go: go('inspector','inspect'), overdue:false, today:true
    };
    const inspectorPendingActionsAll = [
      inspActivityRow,
      { priority:'High', priorityCls:'badge-red', activity:'LV switchgear material inspection', project:'Coastal LNG Terminal / Electrical', due:'Today 16:00', dueSoon:true, statusLabel:'Evidence due', statusCls:'badge-gold', actionLabel:'Open', go: go('inspector','inspect'), overdue:false, today:true },
      { priority:'Medium', priorityCls:'badge-gold', activity:'Cable routing inspection', project:'Coastal LNG Terminal / Electrical', due:'08 Sep 09:00', dueSoon:false, statusLabel:'Scheduled', statusCls:'badge-blue', actionLabel:'View', go: go('inspector','inspect'), overdue:false, today:false },
      { priority:'Medium', priorityCls:'badge-gold', activity:'Earthing continuity test', project:'Substation Building 2 / Electrical', due:'09 Sep 11:30', dueSoon:false, statusLabel:'Scheduled', statusCls:'badge-blue', actionLabel:'View', go: go('inspector','inspect'), overdue:false, today:false },
      { priority:'Low', priorityCls:'badge-grey', activity:'Review vendor test pack', project:'Meridian Energy / QA', due:'10 Sep', dueSoon:false, statusLabel:'Draft', statusCls:'badge-grey', actionLabel:'Continue', go: go('inspector','inspect'), overdue:false, today:false },
      { priority:'High', priorityCls:'badge-red', activity:'Signal cabinet earthing check', project:'Signal Renewal Package 3 / Signalling', due:'Yesterday', dueSoon:false, statusLabel:'Overdue', statusCls:'badge-red', actionLabel:'Open', go: go('inspector','inspect'), overdue:true, today:false },
      { priority:'Medium', priorityCls:'badge-gold', activity:'Track circuit bonding review', project:'Signal Renewal Package 3 / Signalling', due:'2 days ago', dueSoon:false, statusLabel:'Overdue', statusCls:'badge-red', actionLabel:'Open', go: go('inspector','inspect'), overdue:true, today:false }
    ];
    const inspectorTabCounts = {
      all: inspectorPendingActionsAll.length,
      today: inspectorPendingActionsAll.filter(r => r.today).length,
      overdue: inspectorPendingActionsAll.filter(r => r.overdue).length
    };
    const inspectorTabs = [
      { key:'all', label:'All', n:inspectorTabCounts.all },
      { key:'today', label:'Today', n:inspectorTabCounts.today },
      { key:'overdue', label:'Overdue', n:inspectorTabCounts.overdue }
    ].map(t => ({ ...t, cls: st.inspectorTab===t.key ? 'inspectortab active' : 'inspectortab', go: this.setInspectorTab(t.key) }));
    const inspectorPendingActions = st.inspectorTab==='today' ? inspectorPendingActionsAll.filter(r=>r.today) : (st.inspectorTab==='overdue' ? inspectorPendingActionsAll.filter(r=>r.overdue) : inspectorPendingActionsAll);
    const inspectorAwaitingSignoff = [
      { activity:'Cable tray supports', ref:'ITP-EL-014 / WP-06', by:'Liam Chen', when:'18 min ago' },
      { activity:'LV panel inspection', ref:'ITP-EL-021 / HP-12', by:'Sofia Alvarez', when:'1 hr ago' },
      { activity:'Earthing installation', ref:'ITP-EL-018 / HP-04', by:'Daniel Okafor', when:'3 hrs ago' },
      { activity:'Fire stopping inspection', ref:'ITP-FIR-022 / HP-18', by:'Elena Rossi', when:'Yesterday' }
    ];
    const inspectorTodaySchedule = [
      { t:'09:00', label:'Site induction' },
      { t:'11:30', label:'Cable route walk-down' },
      { t:'14:30', label:'Concrete pour' },
      { t:'16:00', label:'Material inspection' }
    ];

    const ncrRaised = st.result==='fail' || st.ncr.status!=='none';
    const ncrStatusLabelMap = { none:'', open:'Open', responded:'Response received', verified:'Awaiting client ack', closed:'Closed' };
    const ncrLabel = ncrStatusLabelMap[st.ncr.status];
    const ncrCls = st.ncr.status==='closed' ? 'badge-green' : (st.ncr.status==='verified' ? 'badge-gold' : 'badge-burg');
    const severityLabel = st.ncr.severity==='major' ? 'Major NCR' : (st.ncr.severity==='minor' ? 'Minor NCR' : '');
    const ncrDescriptionText = st.ncr.description || 'Cover block spacing exceeds tolerance';
    const severityCls = st.ncr.severity==='major' ? 'badge-burg' : 'badge-gold';
    const needsClientAck = st.ncr.status==='verified';
    const ncrRegisterRows = !isMeridianClient ? [] : [
      { id:'MER-NCR-2026-001', desc: ncrDescriptionText, severityLabel: severityLabel || 'Unset', severityCls: severityLabel ? severityCls : 'badge-grey', against:'Trident Marine Construction', status: ncrLabel || 'Not yet raised', cls: ncrLabel ? ncrCls : 'badge-grey', project: clientData.project, type: (severityLabel || 'Unset').replace(' NCR',''), dueDate:'12 Sep 2026', daysOpen: 6 },
      { id:'MER-NCR-2025-014', desc:'Concrete cover deviation, Column C-02', severityLabel:'Minor NCR', severityCls:'badge-gold', against:'Trident Marine Construction', status:'Closed', cls:'badge-green', project: clientData.project, type:'Minor', dueDate:'28 Aug 2025', daysOpen: 11 },
      { id:'MER-NCR-2025-009', desc:'Incorrect bolt torque, Pipe Rack Sec. 14', severityLabel:'Minor NCR', severityCls:'badge-gold', against:'BayShore Rebar Co.', status:'Closed', cls:'badge-green', project: clientData.project, type:'Minor', dueDate:'02 Sep 2025', daysOpen: 18 }
    ];
    const observationRegisterRows = !isMeridianClient ? [] : [
      { id:'MER-OBS-2026-004', desc:'Housekeeping — offcuts near Vault access route', against:'Jags Inspector', status:'Closed', cls:'badge-green', project: clientData.project, type:'Observation', dueDate:'12 Sep 2026', daysOpen: 6 },
      { id:'MER-OBS-2026-005', desc:'Minor surface blemish on screed edge, non-critical', against:'BayShore Rebar Co.', status:'Open', cls:'badge-gold', project: clientData.project, type:'Observation', dueDate:'20 Sep 2026', daysOpen: 13 }
    ];
    const ncrRegisterOpenCount = ncrRegisterRows.filter(r => r.status !== 'Closed' && r.status !== 'Not yet raised').length;
    const ncrRegisterStats = [
      { n: String(ncrRegisterRows.length), l: 'Total NCRs' },
      { n: String(ncrRegisterOpenCount), l: 'Open' },
      { n: String(ncrRegisterOpenCount > 0 ? 1 : 0), l: 'Overdue' },
      { n: String(ncrRegisterRows.filter(r => r.status === 'Closed').length), l: 'Closed' }
    ];
    const observationRegisterStats = [
      { n: String(observationRegisterRows.length), l: 'Total Observations' },
      { n: String(observationRegisterRows.filter(r => r.status === 'Open').length), l: 'Open' },
      { n: String(observationRegisterRows.filter(r => r.status === 'Closed').length), l: 'Closed' }
    ];
    // ---- NCR / Observation Register (client "Registers" screen) — aging chart + search/filter ----
    const buildRegisterAgingChart = (rows) => {
      const buckets = [
        { label:'0-7 days', min:0, max:7 },
        { label:'8-14 days', min:8, max:14 },
        { label:'15-30 days', min:15, max:30 },
        { label:'30+ days', min:31, max:Infinity }
      ];
      const counts = buckets.map(b => rows.filter(r => r.daysOpen >= b.min && r.daysOpen <= b.max).length);
      const maxCount = Math.max(1, ...counts);
      const plotLeft = 30, plotRight = 280, plotTop = 14, plotBottom = 90;
      const plotH = plotBottom - plotTop;
      const slotW = (plotRight - plotLeft) / buckets.length;
      const barW = 34;
      const scaleY = (v) => plotBottom - (v / maxCount) * plotH;
      const bars = buckets.map((b, i) => {
        const slotX = plotLeft + i * slotW;
        const barX = slotX + (slotW - barW) / 2;
        const y = scaleY(counts[i]);
        return { label: b.label, count: counts[i], x: barX.toFixed(1), y: y.toFixed(1), h: (plotBottom - y).toFixed(1), labelX: (slotX + slotW / 2).toFixed(1), valY: (y - 6).toFixed(1) };
      });
      return { bars };
    };
    const ncrAgingChart = buildRegisterAgingChart(ncrRegisterRows);
    const obsAgingChart = buildRegisterAgingChart(observationRegisterRows);
    const onNcrRegisterSearch = this.setNcrRegisterSearch();
    const onNcrRegisterProjectFilter = this.setNcrRegisterProjectFilter();
    const onNcrRegisterTypeFilter = this.setNcrRegisterTypeFilter();
    const onNcrRegisterStatusFilter = this.setNcrRegisterStatusFilter();
    const clearNcrRegisterFilters = this.clearNcrRegisterFilters();
    const ncrRegisterSearchLower = (st.ncrRegisterSearch || '').trim().toLowerCase();
    const ncrRegisterFilteredRows = ncrRegisterRows.filter(r => {
      const matchesSearch = !ncrRegisterSearchLower || (r.id + ' ' + r.desc).toLowerCase().includes(ncrRegisterSearchLower);
      const matchesProject = st.ncrRegisterProjectFilter === 'all' || r.project === st.ncrRegisterProjectFilter;
      const matchesType = st.ncrRegisterTypeFilter === 'all' || r.type === st.ncrRegisterTypeFilter;
      const matchesStatus = st.ncrRegisterStatusFilter === 'all' || r.status === st.ncrRegisterStatusFilter;
      return matchesSearch && matchesProject && matchesType && matchesStatus;
    });
    const ncrRegisterFilterOptions = {
      projects: ncrRegisterRows.map(r => r.project).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      types: ncrRegisterRows.map(r => r.type).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      statuses: ncrRegisterRows.map(r => r.status).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label }))
    };
    const ncrRegisterCountLabel = ncrRegisterFilteredRows.length === 0
      ? ('Showing 0 of ' + ncrRegisterRows.length + ' results')
      : ('Showing 1 to ' + ncrRegisterFilteredRows.length + ' of ' + ncrRegisterRows.length + ' results');
    const onObsRegisterSearch = this.setObsRegisterSearch();
    const onObsRegisterProjectFilter = this.setObsRegisterProjectFilter();
    const onObsRegisterTypeFilter = this.setObsRegisterTypeFilter();
    const onObsRegisterStatusFilter = this.setObsRegisterStatusFilter();
    const clearObsRegisterFilters = this.clearObsRegisterFilters();
    const obsRegisterSearchLower = (st.obsRegisterSearch || '').trim().toLowerCase();
    const obsRegisterFilteredRows = observationRegisterRows.filter(r => {
      const matchesSearch = !obsRegisterSearchLower || (r.id + ' ' + r.desc).toLowerCase().includes(obsRegisterSearchLower);
      const matchesProject = st.obsRegisterProjectFilter === 'all' || r.project === st.obsRegisterProjectFilter;
      const matchesType = st.obsRegisterTypeFilter === 'all' || r.type === st.obsRegisterTypeFilter;
      const matchesStatus = st.obsRegisterStatusFilter === 'all' || r.status === st.obsRegisterStatusFilter;
      return matchesSearch && matchesProject && matchesType && matchesStatus;
    });
    const obsRegisterFilterOptions = {
      projects: observationRegisterRows.map(r => r.project).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      types: observationRegisterRows.map(r => r.type).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label })),
      statuses: observationRegisterRows.map(r => r.status).filter((v,i,a) => a.indexOf(v)===i).map(label => ({ label }))
    };
    const obsRegisterCountLabel = obsRegisterFilteredRows.length === 0
      ? ('Showing 0 of ' + observationRegisterRows.length + ' results')
      : ('Showing 1 to ' + obsRegisterFilteredRows.length + ' of ' + observationRegisterRows.length + ' results');
    const ncrLifecycleRaw = [
      st.ncr.status!=='none',
      st.ncr.status!=='none',
      !!st.ncr.containment,
      !!st.ncr.rootCause,
      st.ncr.status==='responded' || st.ncr.status==='verified' || st.ncr.status==='closed',
      st.ncr.status==='verified' || st.ncr.status==='closed',
      st.ncr.status==='closed'
    ];
    let ncrSequentialBroken = false;
    const ncrLifecycleDefs = ['Open','Assigned','Containment','Root Cause','Corrective Action','Jags Verification', (st.ncr.severity==='major' ? 'Client Ack / Closed' : 'Closed')].map((label,i) => {
      if (!ncrLifecycleRaw[i]) ncrSequentialBroken = true;
      return { label, done: !ncrSequentialBroken };
    });
    let ncrCurrentIdx = ncrLifecycleDefs.findIndex(s => !s.done);
    if (ncrCurrentIdx===-1) ncrCurrentIdx = ncrLifecycleDefs.length-1;
    const ncrLifecycleStages = ncrLifecycleDefs.map((s,i) => ({
      label: s.label, num: i+1, done: s.done, notDone: !s.done,
      dotCls: s.done ? 'done' : (i===ncrCurrentIdx ? 'current' : ''),
      lineCls: (i>0 && ncrLifecycleDefs[i-1].done) ? 'filled' : '',
      labelCls: i===ncrCurrentIdx ? 'current-label' : ''
    }));
    const needsClientItpAccept = clientPersonaSelfService && !st.sign.client;
    const clientAllClear = !needsClientItpAccept && st.witness!=='pending' && !needsClientAck;
    const acceptItp = this.acceptItpAsClient();
    const needsMyApprovalClientAccept = (st.role==='client' && needsClientItpAccept)
      ? [{ id:'clientaccept', itpNumber: meridianItpNumber, client:'Meridian Energy', project: CLIENTS.meridian.project, party:'Client Acceptance', status:'Awaiting acceptance', cls:'badge-gold', signed:false, mine:true, canSign:true, isAccept:true, signFn: acceptItp }]
      : [];
    const needsMyApproval = [...needsMyApprovalClientAccept, ...needsMyApprovalItp];
    const needsMyApprovalEmpty = needsMyApproval.length === 0;
    const needsMyApprovalCount = needsMyApproval.length;
    const approvalsCentreBadge = needsMyApprovalCount > 9 ? '9+' : String(needsMyApprovalCount);
    const hasApprovalsBadge = needsMyApprovalCount > 0;
    const managedChosenCls = isManaged ? 'chosen' : '';
    const selfServiceChosenCls = isSelfService ? 'chosen' : '';
    const chooseManaged = this.setEngagementMode('managed');
    const chooseSelfService = this.setEngagementMode('selfservice');
    const engagementModeLabel = isManaged ? 'Jags-Managed' : 'Client Self-Service';
    const engagementBannerCls = isManaged ? 'banner-wait' : 'banner-ok';
    const engagementModeEffect = isManaged
      ? 'Jags Admin can sign every party on the Approval screen, including ' + clientData.org + '.'
      : clientData.org + "'s own portal now shows an \"Accept ITP\" action — Jags Admin's Approval screen shows their row as \"Signs from their own portal.\"";

    const currentBrandMode = st.engagementBrandModeByClient[st.activeClient];
    const brandModeLabels = { 'jags-led':'Jags-led', 'co-branded':'Co-branded', 'white-label':'White-label' };
    const currentBrandModeLabel = brandModeLabels[currentBrandMode];
    const jagsLedChosenCls = currentBrandMode==='jags-led' ? 'chosen' : '';
    const coBrandedChosenCls = currentBrandMode==='co-branded' ? 'chosen' : '';
    const whiteLabelChosenCls = currentBrandMode==='white-label' ? 'chosen' : '';
    const chooseJagsLed = this.setBrandMode('jags-led');
    const chooseCoBranded = this.setBrandMode('co-branded');
    const chooseWhiteLabel = this.setBrandMode('white-label');
    const whiteLabelCodeMap = { meridian:'MEH-EL', northgate:'NGR-SIG' };
    const brandNumberingPreview = currentBrandMode==='white-label'
      ? whiteLabelCodeMap[st.activeClient] + '-ITP-0001'
      : clientData.numbering.itp.replace('{SEQ}','001');
    const brandHeaderPreview = currentBrandMode==='white-label' ? (clientData.org + ' · QMP')
      : (currentBrandMode==='co-branded' ? (clientData.org + ' · Powered by Jags Assurance') : 'JAGS ASSURANCE · QMP Inspect');
    const brandModeEffect = currentBrandMode==='jags-led'
      ? 'Jags logo and branding, Jags document numbering (e.g. ' + brandNumberingPreview + ').'
      : (currentBrandMode==='co-branded'
        ? clientData.org + ' logo + “Powered by Jags Assurance”, numbering stays Jags’ by default (' + brandNumberingPreview + ').'
        : clientData.org + ' logo only, no Jags mark — numbering fully switches to their own convention (' + brandNumberingPreview + '). Jags keeps a hidden internal reference for audit.');
    const brandWordmarkOrg = st.role==='client' ? CLIENTS.meridian.org : clientData.org;
    const brandWordmarkMode = st.role==='client' ? st.engagementBrandModeByClient.meridian : currentBrandMode;
    const isDefaultWordmark = brandWordmarkMode==='jags-led';
    const isNotDefaultWordmark = !isDefaultWordmark;
    const wordmarkText = brandWordmarkMode==='white-label' ? (brandWordmarkOrg + ' · QMP')
      : (brandWordmarkMode==='co-branded' ? (brandWordmarkOrg + ' · Powered by Jags Assurance') : 'JAGS ASSURANCE · QMP Inspect');

    const onboardingStepDefs = ['Project Details','Team & Parties','Disciplines','Documents','Numbering','ITP Approval Chain','Ready for Execution'];
    const onboardingComplete = st.delRioStep > onboardingStepDefs.length;
    const onboardingSteps = onboardingStepDefs.map((label, i) => {
      const num = i + 1;
      const done = num < st.delRioStep;
      const current = num === st.delRioStep;
      return { label, num, done, cls: done ? 'badge-green' : (current ? 'badge-gold' : 'badge-grey'), statusLabel: done ? 'Done' : (current ? 'In Progress' : 'Pending') };
    });
    const onboardingCurrentLabel = onboardingStepDefs[st.delRioStep - 1] || '';
    const democontrolPosCls = 'pos-' + st.democontrolPos;
    const democontrolCollapsedCls = st.democontrolCollapsed ? 'collapsed' : '';
    const democontrolCollapsed = st.democontrolCollapsed;
    const democontrolExpanded = !st.democontrolCollapsed;
    const cycleDemoControlPos = this.cycleDemoControlPos();
    const toggleDemoControlCollapsed = this.toggleDemoControlCollapsed();
    const onboardingNotComplete = !onboardingComplete;
    const advanceOnboarding = this.advanceOnboarding();

    const scenarioDefs = [
      ['A','Jags-led normal inspection'], ['B','Failed inspection / NCR'], ['C','Multi-discipline Hold Point'],
      ['D','Client-led project'], ['E','Handover'], ['F','Revision change']
    ];
    const scenarioButtons = scenarioDefs.map(([key,title]) => ({
      key, title, cls: st.activeScenario===key ? 'active' : '', go: this.runScenario(key)
    }));

    const dbItp = allSigned ? 25 : 0;
    const dbExec = canInspect ? 25 : 0;
    const dbNcrOk = (!ncrRaised || st.ncr.status==='closed') ? 25 : 0;
    const dbCert = st.result==='pass' ? 25 : 0;
    const dbTotal = dbItp + dbExec + dbNcrOk + dbCert;
    const dbColor = (p) => p===25 ? '#2f6f4e' : (p>0 ? '#F5C518' : '#e6ddd3');
    const dbDocs = (items) => items.map(([text,done]) => (done ? '✓ ' : '○ ') + text);
    const dbRows = [
      { label:'ITP activities approved', pct:dbItp, color:dbColor(dbItp), docs: dbDocs([
        [meridianItpNumber + ' Rev 2 — Civil Foundations', allSigned], ['5 party sign-offs on record', allSigned]
      ])},
      { label:'Inspections complete (all parties)', pct:dbExec, color:dbColor(dbExec), docs: dbDocs([
        ['CHK-001 Reinforcement Placement — BayShore Rebar Co.', st.subSubmitted],
        ['Contractor review — Trident Marine Construction', st.contractorApproved],
        ['Measurement report — Apex Testing Labs', st.tpiUploaded],
        ['Witness record — Meridian Energy', st.witness!=='pending']
      ])},
      { label:'NCRs closed', pct:dbNcrOk, color:dbColor(dbNcrOk), docs: dbDocs([
        ['MER-NCR-2026-001 raised', ncrRaised], ['Corrective action on file', st.ncr.status==='responded'||st.ncr.status==='verified'||st.ncr.status==='closed'],
        ['Closed / acknowledged', st.ncr.status==='closed']
      ])},
      { label:'Certificates / IRNs issued', pct:dbCert, color:dbColor(dbCert), docs: dbDocs([
        ['MER-JAGS-IRN-001 — Inspection Release Notice', st.result==='pass']
      ])}
    ];

    const regColor = (days) => days < 0 ? 'badge-burg' : (days <= 30 ? 'badge-gold' : 'badge-green');
    const regLabel = (days) => days < 0 ? 'Overdue' : (days <= 30 ? 'Due soon' : 'Current');
    const calibrationRegister = !isMeridianClient ? [] : [
      { instrument:'Profometer PM-8 (cover meter)', lastCal:'2026-01-12', due:'2027-01-12', daysRemaining:127 },
      { instrument:'Digital Torque Wrench TW-220', lastCal:'2025-11-02', due:'2026-11-02', daysRemaining:56 },
      { instrument:'Concrete Test Hammer CH-4', lastCal:'2025-08-20', due:'2026-08-20', daysRemaining:-18 }
    ].map(r => ({ ...r, cls: regColor(r.daysRemaining), label: regLabel(r.daysRemaining) }));
    const welderRegister = !isMeridianClient ? [] : [
      { welder:'R. Alvarez', process:'SMAW 6G', cert:'WQ-2291', expiry:'2026-12-01', daysRemaining:85 },
      { welder:'K. Osei', process:'GTAW 6G', cert:'WQ-2308', expiry:'2026-10-05', daysRemaining:28 },
      { welder:'M. Tran', process:'FCAW 3G', cert:'WQ-2140', expiry:'2026-06-01', daysRemaining:-98 }
    ].map(r => ({ ...r, cls: regColor(r.daysRemaining), label: regLabel(r.daysRemaining) }));
    const materialCodeCls = { A:'badge-green', B:'badge-blue', C:'badge-gold', D:'badge-burg' };
    const materialRegister = !isMeridianClient ? [] : [
      { material:'Rebar 16mm Grade 460B — Heat 88213', code:'A', note:'Approved, mill cert on file' },
      { material:'Ready-mix Concrete C32/40 — Batch 4471', code:'A', note:'Approved, batch cert on file' },
      { material:'Formwork Release Agent — Lot 902', code:'C', note:'Conditional — awaiting MSDS confirmation' }
    ].map(r => ({ ...r, cls: materialCodeCls[r.code] }));
    const punchListRows = !isMeridianClient ? [] : st.punchListItems.map((p, i) => ({
      text: p.text, raisedBy: p.raisedBy, open: p.open,
      label: p.open ? 'Open' : 'Closed', cls: p.open ? 'badge-gold' : 'badge-green',
      canClose: p.open, closeFn: this.closePunchItem(i)
    }));
    const punchListOpenCount = st.punchListItems.filter(p => p.open).length;
    const punchListAllClear = punchListOpenCount === 0;
    const registersEmptyForNorthgate = !isMeridianClient;
    const punchListSummaryLabel = punchListAllClear ? 'All clear' : (punchListOpenCount + ' open');
    const punchListSummaryCls = punchListAllClear ? 'badge-green' : 'badge-gold';

    const assignmentStatusMap = { not_started:['Not Started','badge-grey'], in_progress:['In Progress','badge-gold'], complete:['Complete','badge-green'] };
    const assignmentRows = st.assignments.map((a, i) => {
      const [label, cls] = assignmentStatusMap[a.status];
      return { ...a, statusLabel: label, statusCls: cls, openFn: this.openAssignment(i) };
    });
    const activeAssignmentRaw = st.assignments[st.activeAssignmentIdx];
    const [activeAssignmentStatusLabel, activeAssignmentStatusCls] = assignmentStatusMap[activeAssignmentRaw.status];
    const assignmentMeasurementRows = activeAssignmentRaw.measurements.map((m, i) => ({
      item: m.item, criteria: m.criteria, result: m.result,
      recorded: m.status === 'recorded', pending: m.status !== 'recorded',
      label: m.status === 'recorded' ? (m.pass ? 'Pass' : 'Fail') : 'Pending',
      cls: m.status === 'recorded' ? (m.pass ? 'badge-green' : 'badge-burg') : 'badge-grey',
      recordFn: this.recordMeasurement(i)
    }));
    const assignmentPunchRows = activeAssignmentRaw.punchList.map((p, i) => ({
      text: p.text, open: p.open, label: p.open ? 'Open' : 'Closed', cls: p.open ? 'badge-gold' : 'badge-green',
      canClose: p.open, closeFn: this.closeAssignmentPunch(i)
    }));
    const assignmentPartyLabels = { contractor: 'Contractor', tpi: 'TPI / Lab', jags: 'Jags Assurance', client: 'Client' };
    const activeAssignmentSignKeys = meridianAssignmentSignKeys;
    const assignmentSignRows = activeAssignmentSignKeys.map((party) => ({
      party, label: assignmentPartyLabels[party], org: activeAssignmentRaw.signOrgs[party],
      signed: activeAssignmentRaw.sign[party],
      cls: activeAssignmentRaw.sign[party] ? 'badge-green' : 'badge-gold',
      statusLabel: activeAssignmentRaw.sign[party] ? 'Signed' : 'Pending',
      signFn: this.signAssignmentParty(party)
    }));
    const assignmentHasPunch = activeAssignmentRaw.punchList.length > 0;
    const assignmentAllMeasuresRecorded = activeAssignmentRaw.measurements.every((m) => m.status === 'recorded');
    const assignmentPunchAllClear = activeAssignmentRaw.punchList.every((p) => !p.open);
    const assignmentAllSigned = activeAssignmentSignKeys.every((key) => activeAssignmentRaw.sign[key]);
    const assignmentReady = activeAssignmentRaw.status === 'complete';
    const assignmentNotReady = !assignmentReady;
    const assignmentCanGenerate = assignmentAllMeasuresRecorded && assignmentPunchAllClear && assignmentAllSigned && !assignmentReady;
    const assignmentDocLabel = activeAssignmentRaw.type === 'FAT' ? 'FAT Report' : 'Test Certificate';
    const assignmentBlocked = !assignmentCanGenerate && !assignmentReady;
    const assignmentNotReadyReason = !assignmentAllMeasuresRecorded ? 'Record all measurements first' : (!assignmentPunchAllClear ? 'Close all punch-list items first' : (!assignmentAllSigned ? 'All parties must sign first' : ''));
    const activeAssignment = { ...activeAssignmentRaw, statusLabel: activeAssignmentStatusLabel, statusCls: activeAssignmentStatusCls, docLabel: assignmentDocLabel };

    const assignmentPhotoRows = (activeAssignmentRaw.photos || []).map((p) => ({ ...p }));
    const fatReportChecklistRows = [
      { n:1, item:'Document and Visual Inspection', req:'Per ' + activeAssignmentRaw.standardRef, result:'PASS' },
      { n:2, item:'Dimensional Check', req:'Per ' + activeAssignmentRaw.standardRef, result:'PASS' },
      { n:3, item:'Functional / Performance Test', req:'Per ' + activeAssignmentRaw.standardRef, result:'PASS' },
      { n:4, item:'Safety Systems Verification', req:'Per ' + activeAssignmentRaw.standardRef, result:'PASS' }
    ];
    const fatReportPunchRows = assignmentPunchRows.map((p, i) => ({
      ...p, n: i + 1, category:'Minor', owner:'Vendor', targetClose:'25 Sep 2026'
    }));
    const fatConditionalPass = activeAssignmentRaw.punchList.some((p) => p.open);
    const fatPlainPass = !fatConditionalPass;
    const fatReportPhotoRows = assignmentPhotoRows.slice(0, 3);
    const fatDocNo = activeAssignmentRaw.number;
    const fatRev = '0';
    const fatDate = '18 Sep 2026';
    const fatPage = '1 of 1';

    const dbBlockersCount = dbRows.filter(r => r.pct < 100).length;
    const myInspectionNotifPending = st.notifications.filter(n => n.role===st.role && n.category==='inspection' && n.status==='unread').length;
    const opsSnapshot = [
      { label:'Approvals', primary: String(needsMyApprovalCount), secondary: needsMyApprovalCount>0 ? 'need action' : 'all clear', cls: needsMyApprovalCount>0?'badge-burg':'badge-green', go: openApprovalsCentre },
      { label:'Inspections', primary: String(myInspectionNotifPending), secondary: myInspectionNotifPending>0 ? 'pending' : 'none pending', cls: myInspectionNotifPending>0?'badge-gold':'badge-green', go: this.openMyWork() },
      { label:'Witness', primary: st.witness==='pending' ? '1' : '0', secondary: st.witness==='pending' ? 'open' : 'clear', cls: st.witness==='pending'?'badge-gold':'badge-green', go: () => this.setState({ role:'client', screen:'witness' }) },
      { label:'NCR', primary: st.ncr.status==='open' ? '1' : '0', secondary: st.ncr.status==='open' ? 'response due' : 'none open', cls: st.ncr.status==='open'?'badge-burg':'badge-green', go: () => this.setState({ role:'inspector', screen:'ncr' }) },
      { label:'Revision Alerts', primary: st.vaultRevisionAlert ? '3' : '0', secondary: st.vaultRevisionAlert ? 'records affected' : 'none', cls: st.vaultRevisionAlert?'badge-burg':'badge-green', go: () => this.setState({ role:'admin', screen:'vault' }) },
      { label:'Data Book', primary: String(dbBlockersCount), secondary: dbBlockersCount>0 ? 'blockers' : 'ready', cls: dbBlockersCount>0?'badge-gold':'badge-green', go: this.openProjectControl() }
    ];

    const repState = (ok) => ok ? ['Available','badge-green'] : ['Pending','badge-grey'];
    const [repIrnLabel,repIrnCls] = repState(st.result==='pass');
    const [repNcrLabel,repNcrCls] = repState(!ncrRaised || st.ncr.status==='closed');
    const [repDbLabel,repDbCls] = repState(dbTotal===100);
    const [repHoLabel,repHoCls] = repState(st.handover);

    const logRows = st.log.slice().reverse();
    const logEmpty = st.log.length===0;
    const clientLogRows = logRows.filter(l => !l.text.includes('Northgate'));
    const clientLogEmpty = clientLogRows.length===0;
    const clientNcrEmpty = !ncrRaised && st.observation.status==='none';

    const needsAction = {
      admin: !allSigned,
      inspector: (canInspect && st.result==='none') || st.ncr.status==='responded',
      contractor: (st.subSubmitted && !st.contractorApproved) || st.ncr.status==='open',
      sub: !st.subSubmitted,
      tpi: !st.tpiUploaded,
      client: st.witness==='pending' || needsClientAck
    };
    const stageRaw = [
      true,
      allSigned,
      canInspect && st.result!=='none',
      (!ncrRaised || st.ncr.status==='closed') && st.observation.status!=='open',
      dbTotal===100,
      st.handover
    ];
    let sequentialBroken = false;
    const stageDefs = ['Project Setup','ITP Development','Execution','NCR / Observation','Data Book','Handover'].map((label,i) => {
      if (!stageRaw[i]) sequentialBroken = true;
      return { label, done: !sequentialBroken };
    });
    let currentIdx = stageDefs.findIndex((s) => !s.done);
    if (currentIdx === -1) currentIdx = stageDefs.length - 1;
    const stages = stageDefs.map((s, i) => ({
      label: s.label, num: i + 1, done: s.done, notDone: !s.done,
      dotCls: s.done ? 'done' : (i===currentIdx ? 'current' : ''),
      lineCls: (i > 0 && stageDefs[i-1].done) ? 'filled' : '',
      labelCls: i===currentIdx ? 'current-label' : ''
    }));
    const stageGoMap = [go('admin','setup'), go('admin','itp'), go('admin','activity'), go('admin','register'), go('admin','register'), null];
    const clickableStages = stages.map((s, i) => ({ ...s, go: stageGoMap[i], clickable: !!stageGoMap[i] }));

    const itpPctEarly = allSigned ? 100 : Math.round((signedCount/totalSignSlots)*100);
    const projectHealth = [
      { label:'ITP Development', pct: itpPctEarly },
      { label:'ITP Approval', pct: Math.round(signedCount/totalSignSlots*100) },
      { label:'Inspections', pct: canInspect ? 100 : Math.round(fieldAnsweredCount/5*100) },
      { label:'NCR Closeout', pct: (!ncrRaised || st.ncr.status==='closed') ? 100 : (st.ncr.status==='responded'||st.ncr.status==='verified' ? 60 : 25) },
      { label:'Data Book', pct: dbTotal },
      { label:'Handover', pct: st.handover ? 100 : 0 }
    ].map(r => ({ ...r, barColor: r.pct===100 ? '#2f6f4e' : (r.pct>0 ? '#F5C518' : '#e6ddd3') }));
    const overallReadiness = Math.round(projectHealth.reduce((sum,r) => sum + r.pct, 0) / projectHealth.length);

    const disciplineDemoPct = { meridian: [itpPctEarly, 40, 35, 55], northgate: [0, 0, 0, 0] };
    const disciplinesWithPct = clientData.disciplines.map((name, i) => ({ name, pct: (disciplineDemoPct[st.activeClient] || [])[i] || 0 }))
      .map(r => ({ ...r, barColor: r.pct>=80 ? '#2f6f4e' : (r.pct>0 ? '#F5C518' : '#e6ddd3'), go: this.openDiscipline(r.name) }));

    const isCivilDiscipline = st.activeDiscipline==='Civil';
    const instance0StatusLabel = st.result==='pass' ? 'PASS' : (st.result==='fail' ? (ncrRaised && st.ncr.status!=='closed' ? 'NCR' : 'FAIL') : (canInspect ? 'READY' : 'IN PROGRESS'));
    const instance0StatusCls = st.result==='pass' ? 'badge-green' : (st.result==='fail' ? 'badge-burg' : (canInspect ? 'badge-gold' : 'badge-grey'));
    const inspectionInstances = [
      { idx:0, location:'Foundation F-001', statusLabel: instance0StatusLabel, statusCls: instance0StatusCls, go: this.openInstance(0) },
      { idx:1, location:'Foundation F-002', statusLabel:'PASS', statusCls:'badge-green', go: this.openInstance(1) },
      { idx:2, location:'Slab B1 Grid 4-6', statusLabel:'PASS', statusCls:'badge-green', go: this.openInstance(2) },
      { idx:3, location:'Column C-04', statusLabel:'PENDING', statusCls:'badge-gold', go: this.openInstance(3) },
      { idx:4, location:'Slab B2 Grid 1-3', statusLabel:'SCHEDULED', statusCls:'badge-grey', go: this.openInstance(4) },
      { idx:5, location:'Foundation F-003', statusLabel:'PASS', statusCls:'badge-green', go: this.openInstance(5) }
    ];
    const disciplineStats = {
      activities: isCivilDiscipline ? 1 : 0,
      inspections: isCivilDiscipline ? inspectionInstances.length : 0,
      holdPoints: isCivilDiscipline ? 1 : 0,
      witnessPoints: isCivilDiscipline ? 1 : 0,
      ncrs: isCivilDiscipline ? (ncrRaised && st.ncr.status!=='closed' ? 1 : 0) : 0,
      completionPct: isCivilDiscipline ? overallReadiness : 0
    };
    const instanceStaticDetail = {
      1: { checklist:'5/5 items answered Yes', evidence:'2 photos attached', signature:'Signed by S. Alvarez', ncr:'None' },
      2: { checklist:'5/5 items answered Yes', evidence:'3 photos attached', signature:'Signed by S. Alvarez', ncr:'None' },
      3: { checklist:'2/5 items answered', evidence:'0 photos attached', signature:'Not yet signed', ncr:'None' },
      4: { checklist:'Not started', evidence:'—', signature:'—', ncr:'None' },
      5: { checklist:'5/5 items answered Yes', evidence:'4 photos attached', signature:'Signed by S. Alvarez', ncr:'None' }
    };
    const instance0Detail = {
      checklist: fieldAnsweredCount + '/5 items answered',
      evidence: fieldPhotosLabel,
      signature: fieldSignedLabel,
      ncr: (st.ncr.status!=='none') ? ('MER-NCR-2026-001' + (severityLabel ? ' (' + severityLabel + ')' : '')) : 'None'
    };
    const selectedInstanceBase = inspectionInstances[st.selectedInstanceIdx] || inspectionInstances[0];
    const selectedInstanceDetail = st.selectedInstanceIdx===0 ? instance0Detail : (instanceStaticDetail[st.selectedInstanceIdx] || instance0Detail);
    const selectedInstance = { ...selectedInstanceBase, ...selectedInstanceDetail, isReal: st.selectedInstanceIdx===0 };
    const isNotCivilDiscipline = !isCivilDiscipline;
    const selectedInstanceNotReal = st.selectedInstanceIdx!==0;

    const clientHealthMeridianCls = overallReadiness>=80 ? 'badge-green' : (overallReadiness>=50 ? 'badge-gold' : 'badge-burg');
    const riskItems = [];
    if (st.ncr.severity==='major' && st.ncr.status!=='none' && st.ncr.status!=='closed') riskItems.push({ icon:'🔴', text:'1 Major NCR open (MER-NCR-2026-001)' });
    if (st.witness==='pending') riskItems.push({ icon:'🟡', text:'1 Hold/Witness point awaiting Meridian Energy' });
    if (!allSigned) riskItems.push({ icon:'🟡', text:(totalSignSlots-signedCount) + ' ITP sign-offs still outstanding' });
    if (st.vaultRevisionAlert) riskItems.push({ icon:'🟠', text:'1 document revision change with unresolved linked records' });
    const riskItemsEmpty = riskItems.length===0;

    const criticalActions = [];
    if (!allSigned) criticalActions.push((totalSignSlots - signedCount) + ' of ' + totalSignSlots + ' parties still need to sign ' + itpNumber + '.');
    if (isMeridianClient && st.ncr.status!=='none' && st.ncr.status!=='closed') criticalActions.push('MER-NCR-2026-001 (' + severityLabel + ') is still open — ' + (ncrLabel || 'in progress') + '.');
    if (isMeridianClient && st.witness==='pending') criticalActions.push('Client witness point open on Activity 2.1.');
    if (dbTotal<100) criticalActions.push('Data Book is at ' + dbTotal + '% — handover is blocked until it reaches 100%.');
    const criticalActionsEmpty = criticalActions.length===0;

    const clientProjectsCount = 1;
    const clientOpenNcrCount = isMeridianClient ? (ncrRaised && st.ncr.status!=='closed' ? 1 : 0) : 0;
    const clientActiveItpCount = 1;
    const clientDataBooksReady = isMeridianClient ? (dbTotal===100 ? 1 : 0) : 0;

    const myWorkCount = Object.values(needsAction).filter(Boolean).length;
    const myWorkAction = [];
    if (!allSigned) myWorkAction.push({ text: (totalSignSlots-signedCount) + ' parties still need to sign ' + itpNumber + '.', who:'Jags Admin', go: go('admin','approval') });
    if (st.ncr.status==='open') myWorkAction.push({ text: 'MER-NCR-2026-001 (' + severityLabel + ') needs a corrective action response.', who:contractorActorName, go: go('contractor','ncr') });
    if (st.ncr.status==='responded') myWorkAction.push({ text: 'Corrective action on MER-NCR-2026-001 is ready for Jags verification.', who:'Jags Inspector', go: go('inspector','ncr') });
    if (needsClientAck) myWorkAction.push({ text: 'Major NCR MER-NCR-2026-001 needs Meridian Energy\'s acknowledgement.', who:'Meridian Energy', go: go('client','dash') });
    if (st.witness==='pending') myWorkAction.push({ text: 'Witness point open on Activity 2.1 (Foundation F-001).', who:'Meridian Energy', go: go('client','witness') });
    if (st.subSubmitted && !st.contractorApproved) myWorkAction.push({ text: 'Contractor review pending on Activity 2.1 checklist.', who:contractorActorName, go: go('contractor','dash') });
    if (canInspect && st.result==='none') myWorkAction.push({ text: 'Activity 2.1 has all evidence in — ready for a Pass/Fail decision.', who:'Jags Inspector', go: go('inspector','inspect') });
    if (needsClientItpAccept) myWorkAction.push({ text: itpNumber + ' is awaiting Meridian Energy\'s acceptance.', who:'Meridian Energy', go: go('client','dash') });
    st.itpPackages.forEach((pkg) => {
      if (pkg.status === 'built') {
        const pkgSignedN = activePkgRequiredKeys.filter((k) => pkg.sign[k]).length;
        if (pkgSignedN < activePkgRequiredKeys.length) {
          myWorkAction.push({ text: (activePkgRequiredKeys.length - pkgSignedN) + ' part(y/ies) still need to sign ' + pkg.itpNumber + ' (' + pkg.name + ').', who:'Jags Admin', go: go('admin','packages') });
        }
      }
    });
    st.assignments.forEach((a) => {
      if (a.status !== 'complete') {
        const pendingMeasures = a.measurements.filter((m) => m.status !== 'recorded').length;
        const openPunch = a.punchList.filter((p) => p.open).length;
        const pendingSign = meridianAssignmentSignKeys.filter((k) => !a.sign[k]).length;
        if (pendingMeasures > 0) {
          myWorkAction.push({ text: pendingMeasures + ' measurement(s) still to record on ' + a.number + ' (' + a.title + ').', who:'Jags Admin', go: go('admin','assignments') });
        } else if (openPunch > 0) {
          myWorkAction.push({ text: openPunch + ' punch-list item(s) open on ' + a.number + '.', who:'Jags Admin', go: go('admin','assignments') });
        } else if (pendingSign > 0) {
          myWorkAction.push({ text: pendingSign + ' sign-off(s) still needed on ' + a.number + ' (' + a.title + ').', who:'Jags Admin', go: go('admin','assignments') });
        }
      }
    });
    const myWorkWaiting = [];
    if (!st.subSubmitted) myWorkWaiting.push({ text: 'Subcontractor checklist for Activity 2.1 not yet submitted.', who:subActorName, go: go('sub','field') });
    if (!st.tpiUploaded) myWorkWaiting.push({ text: 'Measurement report from the test lab is still pending.', who:'Apex Testing Labs', go: go('tpi','upload') });
    const myWorkRecent = st.log.slice(-4).reverse();
    const myWorkActionEmpty = myWorkAction.length===0;
    const myWorkWaitingEmpty = myWorkWaiting.length===0;
    const myWorkRecentEmpty = myWorkRecent.length===0;

    const searchIndex = [
      { label: itpNumber, sub: 'ITP · ' + clientData.project, go: go('admin','itp') },
      { label: 'Activity 2.1 — Reinforcement Inspection', sub: 'Foundation F-001', go: go('admin','activity') },
      { label: 'MER-NCR-2026-001', sub: 'NCR · ' + severityLabel, go: go('inspector','ncr') },
      { label: 'DRG-CIV-001 Rev 3', sub: 'Drawing · Foundation Reinforcement Detail', go: go('admin','vault') },
      { label: 'SPEC-CIV-014', sub: 'Specification · Civil Concrete & Reinforcement Spec', go: go('admin','vault') },
      { label: 'Priya Desai', sub: 'Jags Admin · Quality Engineer', go: go('admin','settings') },
      { label: 'Ravi Kapoor', sub: 'Jags Inspector', go: go('inspector','dash') },
      { label: 'Marcus Tan', sub: 'Trident Marine Construction · Site Manager', go: go('contractor','dash') },
      { label: 'Sofia Alvarez', sub: 'BayShore Rebar Co. · Field Technician', go: go('sub','field') },
      { label: 'Dr. Amara Rao', sub: 'Apex Testing Labs', go: go('tpi','dash') },
      { label: 'Naveen Iyer', sub: 'Meridian Energy · Project Owner', go: go('client','dash') },
      { label: 'Trident Marine Construction', sub: 'Main Contractor', go: go('contractor','dash') },
      { label: 'BayShore Rebar Co.', sub: 'Subcontractor', go: go('sub','inbox') },
      { label: 'Apex Testing Labs', sub: 'TPI / Lab', go: go('tpi','dash') },
      { label: 'Meridian Energy', sub: 'Client · Coastal LNG Terminal Ph.2', go: this.openClientWorkspace('meridian') },
      { label: 'Northgate Rail', sub: 'Client · Signal Renewal Package 3', go: this.openClientWorkspace('northgate') },
      { label: northgateItpNumber, sub: 'ITP · Signal Renewal Package 3', go: this.openClientWorkspace('northgate') },
      { label: 'Elena Osei', sub: 'Ferrovia Rail Systems · Contractor', go: this.openClientWorkspace('northgate') },
      { label: 'Tom Whitfield', sub: 'SignalTech Installations · Subcontractor', go: this.openClientWorkspace('northgate') },
      { label: 'Priya Nair', sub: 'Kestrel Test & Certification · TPI / Lab', go: this.openClientWorkspace('northgate') },
      { label: 'Grace Okafor', sub: 'Northgate Rail · Client', go: this.openClientWorkspace('northgate') },
      { label: 'SPEC-SIG-004', sub: 'Specification · Signal Cable Termination Spec', go: this.openClientWorkspace('northgate') },
      { label: 'DRG-SIG-011', sub: 'Drawing · Cable Route Section 3', go: this.openClientWorkspace('northgate') },
      { label: 'Del Rio Petrochem', sub: 'Client · Onboarding, contract signed', go: go('admin','onboarding') },
      { label: 'ITP Register', sub: 'Register · every ITP across clients', go: go('admin','register') },
      { label: 'Audit Trail', sub: 'Register · every action, timestamped', go: go('admin','audit') },
      { label: 'Data Book', sub: 'Coastal LNG Terminal Ph.2 completeness', go: go('client','databook') }
    ];
    const searchQueryLower = st.searchQuery.trim().toLowerCase();
    const searchActive = searchQueryLower.length > 0;
    const searchResults = searchActive
      ? searchIndex.filter(r => (r.label + ' ' + r.sub).toLowerCase().includes(searchQueryLower)).slice(0, 8)
        .map(r => ({ ...r, select: () => { r.go(); this.setState({ searchQuery: '' }); } }))
      : [];
    const searchResultsEmpty = searchActive && searchResults.length===0;
    const onSearchInput = this.onSearchInput();
    const clearSearch = this.clearSearch();
    const qmpModules = [
      { key:'inspect', name:'QMP Inspect', statusLabel: myWorkCount + ' pending', cls:'badge-gold', active:true, hint:'Click to enter the service' },
      { key:'surveillance', name:'QMP Surveillance', statusLabel:'Not licensed', cls:'badge-grey', active:false, hint:'Not licensed for this account' },
      { key:'audit', name:'QMP Audit', statusLabel:'Not licensed', cls:'badge-grey', active:false, hint:'Not licensed for this account' },
      { key:'comply', name:'QMP Comply', statusLabel:'Coming soon', cls:'badge-grey', active:false, hint:'Not yet released' },
      { key:'improve', name:'QMP Improve', statusLabel:'Coming soon', cls:'badge-grey', active:false, hint:'Not yet released' },
      { key:'iso', name:'QMP ISO', statusLabel:'Coming soon', cls:'badge-grey', active:false, hint:'Not yet released' },
      { key:'train', name:'QMP Train', statusLabel:'Coming soon', cls:'badge-grey', active:false, hint:'Not yet released' }
    ].map(m => ({
      ...m,
      styleOpacity: m.active ? 'cursor:pointer;' : 'opacity:.55;cursor:not-allowed;',
      go: m.active ? this.openClientWorkspace('meridian') : this.noopClick()
    }));
    const platformStats = {
      clients: 2, activeProjects: 2,
      partiesAcrossPortfolio: activePartiesCount + CLIENTS.northgate.parties.length,
      openNcrsPortfolio: (st.ncr.status!=='none' && st.ncr.status!=='closed') ? 1 : 0,
      avgPassRate: st.result==='pass' ? '100%' : (st.result==='fail' ? '50%' : 'N/A')
    };
    const recentProjects = [
      { org:'Meridian Energy', project:'Coastal LNG Terminal Ph.2', go: this.openClientWorkspace('meridian') },
      { org:'Northgate Rail', project:'Signal Renewal Package 3', go: this.openClientWorkspace('northgate') }
    ];

    const greetingMap = {
      admin: allSigned
        ? { cls:'ok', title:meridianItpNumber + ' is fully approved.', sub:'Every party has signed off — execution is unlocked project-wide.' }
        : { cls:'attn', title:(totalSignSlots - signedCount) + ' of ' + totalSignSlots + ' parties still need to sign ' + meridianItpNumber + '.', sub:'Execution stays locked for everyone until all parties approve.' },
      inspector: (canInspect && st.result==='none')
        ? { cls:'attn', title:'Activity 2.1 is ready for your decision.', sub:'All evidence is in — record a Pass or Fail.' }
        : (st.ncr.status==='responded' ? { cls:'attn', title:'A corrective action is waiting on your verification.', sub:contractorActorName + ' responded to MER-NCR-2026-001.' }
        : { cls:'ok', title:'Nothing urgent right now.', sub:'The queue will flag itself the moment evidence is complete.' }),
      contractor: (st.subSubmitted && !st.contractorApproved)
        ? { cls:'attn', title:subActorName + ' submitted a checklist for your review.', sub:'Approve it to forward the evidence to Jags Assurance.' }
        : (st.ncr.status==='open' ? { cls:'attn', title:'An NCR is assigned to you.', sub:'MER-NCR-2026-001 needs a corrective action response.' }
        : { cls:'ok', title:'Nothing waiting on you right now.', sub:'You’ll see a badge here the moment something needs a response.' }),
      sub: !st.subSubmitted
        ? { cls:'attn', title:'An inspection is requested on Activity 2.1.', sub:'Foundation F-001 — start the field checklist when ready.' }
        : { cls:'ok', title:'Your submission is with ' + contractorActorName + '.', sub:'You’ll see it move once they review it.' },
      tpi: !st.tpiUploaded
        ? { cls:'attn', title:'A measurement report is due on Activity 2.1.', sub:'Reinforcement cover depth, 38–50mm acceptance range.' }
        : { cls:'ok', title:'Your report is on file.', sub:'Within acceptance range — nothing further needed right now.' },
      client: (st.witness==='pending')
        ? { cls:'attn', title:'A witness point is waiting for you.', sub:'Attend, or waive with a reason on file.' }
        : (needsClientAck ? { cls:'attn', title:'A Major NCR needs your acknowledgement.', sub:'Jags Assurance has verified it — your sign-off closes it.' }
        : { cls:'ok', title:'You’re fully caught up.', sub:'Nothing on Coastal LNG Terminal Ph.2 needs you right now.' })
    };
    const greeting = greetingMap[st.role] || { cls:'ok', title:'', sub:'' };

    const itpPct = allSigned ? 100 : Math.round((signedCount/totalSignSlots)*100);
    const passPct = st.result==='pass' ? 100 : 0;
    const passLabel = st.result==='none' ? '—' : passPct + '%';
    const itpArc = itpPct + ', 100';
    const passArc = passPct + ', 100';

    const clientKpiSix = [
      { n: passLabel, l:'First-time pass rate' },
      { n:'24h', l:'Hold-point turnaround' },
      { n: ncrRaised ? (st.ncr.status==='closed' ? '3' : '—') : '3', l:'NCR close-out (days)' },
      { n: overallReadiness + '%', l:'Data-book readiness' },
      { n:'9 / 12', l:'Inspections completed vs planned' },
      { n: itpPct + '%', l:'ITP completion' }
    ];
    const clientProgressByProject = [
      { name: clientData.project, pct: itpPct },
      { name:'North Jetty Upgrade', pct:64 }
    ];
    const clientVendorRanked = [
      { rank:1, name:'Trident Marine Construction', pct: passPct || 92 },
      { rank:2, name:'BayShore Rebar Co.', pct: passPct || 88 },
      { rank:3, name:'Apex Testing Labs', pct:91 }
    ].sort((a,b) => b.pct - a.pct).map((v,i) => ({ ...v, rank:i+1 }));
    const clientOpenItemsRows = [];
    if (needsClientItpAccept) clientOpenItemsRows.push({ ref: meridianItpNumber, item:'ITP awaiting your acceptance', owner:'Meridian Energy', due:'Today', statusLabel:'Awaiting Client', statusCls:'badge-gold', canAct:true, actFn: acceptItp, actLabel:'Accept ITP' });
    if (st.witness==='pending') clientOpenItemsRows.push({ ref:'WP-2.1', item:'Witness point open on Activity 2.1', owner:'Meridian Energy', due:'Today', statusLabel:'In Progress', statusCls:'badge-gold', canAct:false });
    if (needsClientAck) clientOpenItemsRows.push({ ref:'MER-NCR-2026-001', item:'Major NCR needs your acknowledgement', owner:'Meridian Energy', due:'Overdue', statusLabel:'Overdue', statusCls:'badge-red', canAct:false });
    const clientHasOpenItems = clientOpenItemsRows.length > 0;

    const roleIconMap = { admin:'user', inspector:'search', contractor:'building', sub:'hardhat', tpi:'flask', client:'briefcase' };
    const roleList = [
      ['admin','Jags Admin'], ['inspector','Jags Inspector'], ['contractor','Contractor'],
      ['sub','Subcontractor'], ['tpi','TPI / Lab'], ['client','Client']
    ];
    const roles = roleList.map(([key,label]) => ({
      label, icon: roleIconMap[key], cls: st.role===key ? 'active' : '', go: go(key, this._defaultScreen(key)), needsAction: needsAction[key]
    }));
    const personaOptions = roleList.map(([key,label]) => ({
      label, icon: roleIconMap[key], cls: st.role===key ? 'active' : '', go: this.selectPersona(key), needsAction: needsAction[key]
    }));
    const homeCardMeta = {
      admin: { org:'Jags Assurance', desc:'Configure the project, build the ITP, and get every party signed off before execution begins.', color:'#6B1E2C' },
      inspector: { org:'Jags Assurance', desc:'Run the inspection queue, make the pass/fail call, and manage NCRs and observations.', color:'#6B1E2C' },
      contractor: { org:'Trident Marine Construction', desc:'Review and forward the subcontractor’s field submissions; respond to any NCR raised against you.', color:'#8a5a1e' },
      sub: { org:'BayShore Rebar Co.', desc:'Execute the inspection on site — checklist, photo, signature — in a phone-sized field view.', color:'#2f6f4e' },
      tpi: { org:'Apex Testing Labs', desc:'Upload independent measurement and test evidence against the acceptance range.', color:'#2f5f7a' },
      client: { org:'Meridian Energy', desc:'Witness hold points, track KPIs, and hold the final word on your Data Book and handover.', color:'#4a4038' }
    };
    const homeCards = roleList.map(([key,label]) => ({
      label, icon: roleIconMap[key], org: homeCardMeta[key].org, desc: homeCardMeta[key].desc, color: homeCardMeta[key].color,
      needsAction: needsAction[key], go: go(key, this._defaultScreen(key))
    }));
    const loginCardsBase = roleList.map(([key,label]) => ({
      label: key==='client' ? 'Client — Jags-Managed' : label,
      icon: roleIconMap[key], org: homeCardMeta[key].org, color: homeCardMeta[key].color,
      personName: key==='client' ? personaMap[key].name + ' (monitors & approves — Jags runs setup and inspections)' : personaMap[key].name,
      needsAction: needsAction[key], go: this.loginAs(key)
    }));
    const selfServiceClientCard = {
      label: 'Client — Self-Service', icon:'briefcase', org:'Meridian Energy', color:'#2f6f4e',
      personName: 'Naveen Iyer (own team runs setup, parties & inspections using Jags tools)',
      needsAction: false, go: this.loginAsSelfServiceClient()
    };
    const clientIdx = loginCardsBase.findIndex(c => c.org==='Meridian Energy' && c.label==='Client — Jags-Managed');
    const loginCards = [
      ...loginCardsBase.slice(0, clientIdx + 1),
      selfServiceClientCard,
      ...loginCardsBase.slice(clientIdx + 1)
    ];

    return {
      roles, homeCards, navItems, sideLabel: sideLabelMap[st.role], persona, isNotHome, goHome: go('home','home'), is,
      loggedIn: st.loggedIn, notLoggedIn: !st.loggedIn, loginCards, resetDemo,
      verifyCsa, verifyMep, releaseHold, csaDone, mepDone, holdReady, holdLocked, holdReleased: st.holdReleased,
      holdPointLabel, holdPointCls, csaLabel, mepLabel, csaCls, mepCls, holdOutstandingText,
      go_holdpoint: go('admin','holdpoint'), isMeridianClient,
      loginEmail: st.loginEmail, loginPassword: st.loginPassword,
      onLoginEmail: (e) => this.setState({ loginEmail: e.target.value }),
      onLoginPassword: (e) => this.setState({ loginPassword: e.target.value }),
      stages, greeting, itpPct, passPct, passLabel, itpArc, passArc,
      go_adminSetup: go('admin','setup'), go_adminItp: go('admin','itp'), go_adminActivity: go('admin','activity'),
      go_adminChecklist: go('admin','checklist'), go_adminApproval: go('admin','approval'),
      go_meridianSetup: this.openClientWorkspace('meridian'), go_northgateSetup: this.openClientWorkspace('northgate'),
      openProjectControl: this.openProjectControl(),
      go_adminSetupDirect: go('admin','setup'), go_adminVault: go('admin','vault'), go_adminSettings: go('admin','settings'),
      go_inspInspect: go('inspector','inspect'), go_inspNcr: go('inspector','ncr'),
      go_subField: go('sub','field'), go_tpiUpload: go('tpi','upload'),
      setupTabs, parties, disciplines, vaultFolders, itpSections, hwrs, checklistItems, signRows, allSigned,
      openAiItpGen: this.openAiItpGen(), startAiGeneration: this.startAiGeneration(), acceptAiItpDraft: this.acceptAiItpDraft(),
      aiGenDocs, aiGenNotReady, aiGenAttachedCount, aiGenStages, aiGenSectionCount,
      itpPackageRows, itpPackagesBuiltCount, activeItpPackage,
      pkgDocs, pkgNotReady, pkgStages, pkgSectionCount, pkgGenerateBtnLabel, pkgRequirementExplainer,
      startItpPackageGeneration: this.startItpPackageGeneration(), acceptItpPackageDraft: this.acceptItpPackageDraft(),
      go_adminPackages: () => this.setState({ screen:'packages' }),
      uploadReqExplainer, uploadCategory: st.uploadCategory,
      isViewingAsParty, stopViewingAsAddedParty,
      notAllSigned: !allSigned, signedCount, registerMeridianOpen,
      signedAllCls: allSigned ? 'badge-green' : 'badge-gold',
      clientData, otherClientOrg, switchClient, breadcrumbOrg, breadcrumbProject,
      vaultStats, vaultFolderRows, vaultIsSpecFolder, vaultDocRows, vaultSelectedDoc, vaultOtherFolderLabel,
      handoverPortalStats, handoverPortalRows, handoverPortalActivity,
      irnRecord,
      databookBuilder,
      sampleInspectionA4,
      powerbiFilters, powerbiInspectionsChart, powerbiPassRateChart, powerbiNcrTrendChart, powerbiHoldPointGauge, powerbiReadinessByProject, powerbiVendorLeague,
      fieldTraceability, fieldOverallResult, clientWitnessName, onClientWitnessName,
      itpRegisterSearch: st.itpRegisterSearch, itpRegisterProjectFilter: st.itpRegisterProjectFilter,
      itpRegisterDisciplineFilter: st.itpRegisterDisciplineFilter, itpRegisterStatusFilter: st.itpRegisterStatusFilter,
      itpRegisterAllRows, itpRegisterFilteredRows, itpRegisterFilterOptions, itpRegisterCountLabel,
      onItpRegisterSearch, onItpRegisterProjectFilter, onItpRegisterDisciplineFilter, onItpRegisterStatusFilter,
      clearItpRegisterFilters, itpRegisterNoop,
      ncrRegisterSearch: st.ncrRegisterSearch, ncrRegisterProjectFilter: st.ncrRegisterProjectFilter,
      ncrRegisterTypeFilter: st.ncrRegisterTypeFilter, ncrRegisterStatusFilter: st.ncrRegisterStatusFilter,
      obsRegisterSearch: st.obsRegisterSearch, obsRegisterProjectFilter: st.obsRegisterProjectFilter,
      obsRegisterTypeFilter: st.obsRegisterTypeFilter, obsRegisterStatusFilter: st.obsRegisterStatusFilter,
      startWorkIsItp, startWorkIsStandalone, startWorkItpCardCls, startWorkStandaloneCardCls, startWorkSelectedLabel, startWorkSelectItp, startWorkSelectStandalone, startWorkCancel, startWorkContinue,
      assignmentTypeTabs, assignmentDetailTabs, assignmentTabMeasurementsVisible, assignmentTabPhotosVisible, assignmentTabPunchVisible, assignmentTabWitnessVisible, assignmentTabNotesVisible,
      ncrAgingChart, obsAgingChart,
      ncrRegisterFilteredRows, ncrRegisterFilterOptions, ncrRegisterCountLabel,
      onNcrRegisterSearch, onNcrRegisterProjectFilter, onNcrRegisterTypeFilter, onNcrRegisterStatusFilter, clearNcrRegisterFilters,
      obsRegisterFilteredRows, obsRegisterFilterOptions, obsRegisterCountLabel,
      onObsRegisterSearch, onObsRegisterProjectFilter, onObsRegisterTypeFilter, onObsRegisterStatusFilter, clearObsRegisterFilters,
      assignmentPhotoRows, fatReportChecklistRows, fatReportPunchRows, fatConditionalPass, fatPlainPass, fatReportPhotoRows,
      fatDocNo, fatRev, fatDate, fatPage,
      sampleTabs, sampleIrn, sampleItp, sampleWeekly, sampleDatabook, sampleNcrCert, sampleHandover,
      openIrnDoc, openNcrCertDoc, openDatabookDoc, openHandoverDoc, openMonthlyPackDoc, goReportsScreen,
      itpNumber, meridianItpNumber, northgateItpNumber, northgateSignedCount, northgateTotalSlots, northgateOpenText, activePartiesCount, ncrDescriptionText,
      meridianItpPct, northgateItpPct, itpRegisterStats,
      checklistBuilderRows, checklistBuilderPreviewItems, checklistBuilderItemCount, checklistBuilderAnsweredLabel,
      checklistBuilderIsChecklist, checklistBuilderIsForm, checklistBuilderChecklistBtnCls, checklistBuilderFormBtnCls,
      checklistBuilderSetTypeChecklist, checklistBuilderSetTypeForm,
      checklistBuilderIsTablet, checklistBuilderIsDesktop, checklistBuilderDesktopBtnCls, checklistBuilderTabletBtnCls,
      checklistBuilderSetPreviewDesktop, checklistBuilderSetPreviewTablet, checklistBuilderNoop,
      setupPartyRows, settingsUserRows,
      approvalSignRows, approvalSignedCount, approvalAllSigned, approvalNotAllSigned, approvalTotalSlots, totalSignSlots,
      clientAddedPartyRows, showFieldChecklist, fieldSubmittedBannerText,
      logRows, logEmpty, clientLogRows, clientLogEmpty, clientNcrEmpty,
      clientServices, serviceIsCivil, serviceIsElectrical, elecItpNumber, switchToCivil, switchToElectrical,
      clickableStages, projectHealth, overallReadiness, disciplinesWithPct, criticalActions, criticalActionsEmpty,
      clientProjectsCount, clientOpenNcrCount, clientActiveItpCount, clientDataBooksReady,
      myWorkCount, qmpModules, recentProjects, breadcrumbOrgClick, breadcrumbProjectClick, platformStats,
      activeDiscipline: st.activeDiscipline, isCivilDiscipline, isNotCivilDiscipline, disciplineStats, inspectionInstances, selectedInstance, selectedInstanceNotReal,
      vaultRevisionAlert: st.vaultRevisionAlert, vaultRevisionOk: !st.vaultRevisionAlert,
      simulateRevisionUpdate: this.simulateRevisionUpdate(), resolveRevisionAlert: this.resolveRevisionAlert(),
      vaultCurrentRevLabel: st.vaultRevisionAlert ? 'Superseded' : 'CURRENT',
      vaultCurrentRevCls: st.vaultRevisionAlert ? 'badge-grey' : 'badge-green',
      currentBrandMode, currentBrandModeLabel, jagsLedChosenCls, coBrandedChosenCls, whiteLabelChosenCls,
      chooseJagsLed, chooseCoBranded, chooseWhiteLabel, brandNumberingPreview, brandHeaderPreview, brandModeEffect,
      isDefaultWordmark, isNotDefaultWordmark, wordmarkText,
      activeScenario: st.activeScenario, scenarioButtons,
      onboardingSteps, onboardingComplete, onboardingNotComplete, onboardingCurrentLabel, advanceOnboarding,
      democontrolPosCls, democontrolCollapsedCls, democontrolCollapsed, democontrolExpanded, cycleDemoControlPos, toggleDemoControlCollapsed,
      goOnboarding: go('admin','onboarding'),
      clientHealthMeridianCls, riskItems, riskItemsEmpty,
      myWorkAction, myWorkWaiting, myWorkRecent, myWorkActionEmpty, myWorkWaitingEmpty, myWorkRecentEmpty, openMyWork: this.openMyWork(),
      searchQuery: st.searchQuery, searchActive, searchResults, searchResultsEmpty, onSearchInput, clearSearch,
      personaMenuOpen: st.personaMenuOpen, togglePersonaMenu: this.togglePersonaMenu(), personaOptions,
      notifPanelOpen: st.notifPanelOpen, toggleNotifPanel: this.toggleNotifPanel(),
      notifItems, notifItemsEmpty, notifUnreadCount, notifBadgeLabel, notifHasUnread,
      openApprovalsCentre, needsMyApproval, needsMyApprovalEmpty, waitingOnOthers, waitingOnOthersEmpty,
      approvalHistory, approvalHistoryEmpty, needsMyApprovalCount, approvalsCentreBadge, hasApprovalsBadge,
      opsSnapshot,
      queueLabel, queueCls,
      inspectorKpis, inspectorTabs, inspectorPendingActions, inspectorAwaitingSignoff, inspectorTodaySchedule,
      subLabel, subCls, contractorLabel, contractorCls, tpiLabel, tpiCls, witnessLabel, witnessCls,
      canInspect, cannotInspect: !canInspect, missingText,
      resultNone: st.result==='none', resultPass: st.result==='pass', resultFail: st.result==='fail',
      fieldHasFail, flaggedText, flaggedComment, flaggedDescription,
      markPass: () => this.setState({ result:'pass', log:this.appendLog('Jags Assurance passed Activity 2.1 — IRN MER-JAGS-IRN-001 issued.'),
        notifications:[...st.notifications, this.notify('inspection','Activity 2.1 passed inspection — IRN MER-JAGS-IRN-001 issued.','client','witness')] }),
      markFail: () => this.setState({ result:'fail', ncr:{status:'none',severity:null,response:'',containment:false,rootCause:false}, log:this.appendLog('Jags Inspector recorded a Fail result for Activity 2.1.'),
        notifications:[...st.notifications, this.notify('ncr','Activity 2.1 failed inspection — NCR required, corrective action needed.','contractor','ncr')] }),
      toggleContainment: () => this.setState({ ncr:{...st.ncr, containment:true}, log:this.appendLog(contractorActorName + ' logged containment action for MER-NCR-2026-001.') }),
      toggleRootCause: () => this.setState({ ncr:{...st.ncr, rootCause:true}, log:this.appendLog(contractorActorName + ' logged root cause analysis for MER-NCR-2026-001.') }),
      ncrCorrectiveReady: st.ncr.containment && st.ncr.rootCause, ncrCorrectiveNotReady: !(st.ncr.containment && st.ncr.rootCause),
      ncrContainmentDone: !!st.ncr.containment, ncrRootCauseDone: !!st.ncr.rootCause,
      containmentBtnLabel: st.ncr.containment ? 'Containment Logged' : 'Log Containment',
      rootCauseBtnLabel: st.ncr.rootCause ? 'Root Cause Logged' : 'Log Root Cause',
      ncrCopq: st.ncr.severity==='major' ? '$12,500' : '—',
      severityUnset: st.result==='fail' && !st.ncr.severity, severitySet: st.result==='fail' && !!st.ncr.severity,
      minorChosenCls: st.ncr.severity==='minor' ? 'chosen' : '', majorChosenCls: st.ncr.severity==='major' ? 'chosen' : '',
      chooseMinor: () => this.setState({ ncr:{...st.ncr, severity:'minor'} }),
      chooseMajor: () => this.setState({ ncr:{...st.ncr, severity:'major'} }),
      severityLabel, severityCls,
      submitNcr: () => this.setState({ ncr:{...st.ncr, status:'open', description:flaggedDescription}, screen:'ncr', log:this.appendLog('NCR MER-NCR-2026-001 raised (' + severityLabel + '), assigned to ' + contractorActorName + '.') }),
      ncrLabel, ncrCls, ncrNone: st.ncr.status==='none', ncrExists: st.ncr.status!=='none',
      ncrResponded: st.ncr.status==='responded' || st.ncr.status==='verified' || st.ncr.status==='closed',
      ncrOpenOnly: st.ncr.status==='open', ncrAwaitingAck: st.ncr.status==='verified', ncrClosed: st.ncr.status==='closed', ncrNotOpen: st.ncr.status!=='open',
      ncrResponseText: 'Cover blocks reset to 850 mm centres per DRG-CIV-001 Rev 3; crew re-briefed.',
      verifyBtnLabel: st.ncr.severity==='major' ? 'Verify Evidence & Forward to Client' : 'Verify Evidence & Close NCR',
      respondNcr: () => this.setState({ ncr:{...st.ncr, status:'responded'}, log:this.appendLog(contractorActorName + ' submitted corrective action for MER-NCR-2026-001.'),
        notifications:[...st.notifications, this.notify('ncr', contractorActorName + ' submitted corrective action for MER-NCR-2026-001 — verification required.','inspector','ncr')] }),
      verifyClose: () => {
        const nextStatus = st.ncr.severity==='major' ? 'verified' : 'closed';
        const text = nextStatus==='closed'
          ? 'Jags Assurance verified evidence and closed MER-NCR-2026-001.'
          : 'Jags Assurance verified evidence on MER-NCR-2026-001 — forwarded to Meridian Energy for acknowledgement.';
        const extraNotifs = nextStatus==='verified'
          ? [this.notify('ncr','Jags Assurance verified corrective action on MER-NCR-2026-001 — your acknowledgement is requested.','client','ncr')]
          : [];
        this.setState({ ncr:{...st.ncr, status:nextStatus}, log:this.appendLog(text), notifications:[...st.notifications, ...extraNotifs] });
      },
      needsClientAck, needsClientItpAccept, clientAllClear, acceptItp, ncrLifecycleStages,
      clientKpiSix, clientProgressByProject, clientVendorRanked, clientOpenItemsRows, clientHasOpenItems,
      managedChosenCls, selfServiceChosenCls, chooseManaged, chooseSelfService, engagementModeLabel, engagementBannerCls, engagementModeEffect,
      isManaged, isSelfService, clientPersonaManaged, clientPersonaSelfService, meridianModeLabel, northgateModeLabel,
      loginNote: !!st.loginNoteText, loginNoteText: st.loginNoteText,
      showForgotNote: () => this.setState({ loginNoteText: 'In production, this emails a password-reset link to the address above. No email is sent in this demo.' }),
      showSsoNote: () => this.setState({ loginNoteText: 'In production, this redirects to your organisation\'s Microsoft 365 sign-in. Pick a name on the right to continue this demo.' }),
      addClientParty: this.addClientParty(), uploadClientDoc: this.uploadClientDoc(),
      clientAddedParties: st.clientAddedParties, clientUploadedDocs: st.clientUploadedDocs,
      clientUploadedDocsEmpty: st.clientUploadedDocs.length===0,
      acknowledgeNcr: () => this.setState({ ncr:{...st.ncr, status:'closed'}, log:this.appendLog('Meridian Energy acknowledged closure of MER-NCR-2026-001 (Major NCR).') }),
      obsNone: st.observation.status==='none', obsLogged: st.observation.status!=='none',
      obsOpen: st.observation.status==='open', obsEscalated: st.observation.status==='escalated',
      obsLabel: st.observation.status==='closed' ? 'Closed' : (st.observation.status==='escalated' ? 'Escalated to NCR' : 'Open'),
      obsCls: st.observation.status==='closed' ? 'badge-green' : (st.observation.status==='escalated' ? 'badge-burg' : 'badge-gold'),
      logObservation: () => this.setState({ observation:{status:'open'}, log:this.appendLog('Jags Inspector logged an observation on Foundation F-002 (formwork release agent).') }),
      closeObservation: () => this.setState({ observation:{status:'closed'}, log:this.appendLog('Observation on Foundation F-002 closed — no corrective action required.') }),
      escalateObservation: () => this.setState({
        observation:{status:'escalated'},
        ncr:{ status:'open', severity:'minor', response:'', description:'Formwork release agent unevenly applied on Foundation F-002 — monitor next pour.', containment:false, rootCause:false },
        log: this.appendLog('Observation on Foundation F-002 escalated to MER-NCR-2026-001.')
      }),
      fieldChecklist, reviewChecklist, fieldAnsweredCount, fieldPhotosLabel, fieldSignedLabel, fieldNotComplete, signedCls, sigLineText,
      addPhoto: () => this.setState({ fieldPhotos: Math.min(st.fieldPhotos+1, 5) }),
      toggleSign: () => this.setState({ fieldSigned: !st.fieldSigned }),
      subSubmitted: st.subSubmitted, subNotSubmitted: !st.subSubmitted,
      submitField: () => this.setState({ subSubmitted:true, log:this.appendLog(subActorName + ' submitted Activity 2.1 checklist (' + fieldAnsweredCount + '/5 answered, ' + st.fieldPhotos + ' photos).'),
        notifications:[...st.notifications, this.notify('inspection', subActorName + ' submitted the Activity 2.1 checklist — your review is required.','contractor','dash')] }),
      contractorPending: st.subSubmitted && !st.contractorApproved,
      approveContractor: () => this.setState({ contractorApproved:true, log:this.appendLog(contractorActorName + ' approved and forwarded Activity 2.1 to Jags Assurance.'),
        notifications:[...st.notifications, this.notify('inspection', contractorActorName + ' approved Activity 2.1 — ready for TPI upload and Jags inspection.','inspector','inspect')] }),
      tpiNotUploaded: !st.tpiUploaded, tpiIsUploaded: st.tpiUploaded,
      uploadTpi: () => this.setState({ tpiUploaded:true, log:this.appendLog('Apex Testing Labs uploaded the cover-depth measurement report.'),
        notifications:[...st.notifications,
          this.notify('inspection','Apex Testing Labs uploaded the cover-depth measurement report — ready for Jags inspection.','inspector','inspect'),
          this.notify('witness','Witness point open for Activity 2.1 Pre-Pour Inspection — your attendance is requested.','client','witness')
        ] }),
      witnessPending: st.witness==='pending', witnessDone: st.witness!=='pending',
      witnessPendingNoWaive: st.witness==='pending' && !st.witnessWaiveOpen,
      waiveOpen: st.witness==='pending' && st.witnessWaiveOpen,
      witnessReason: st.witnessReason, witnessWasWaived: st.witness==='waived',
      waiveReasonEmpty: st.witnessReason.trim()==='',
      openWaive: () => this.setState({ witnessWaiveOpen:true }),
      cancelWaive: () => this.setState({ witnessWaiveOpen:false, witnessReason:'' }),
      onWaiveReason: (e) => this.setState({ witnessReason: e.target.value }),
      confirmWaive: () => this.setState({ witness:'waived', witnessWaiveOpen:false, log:this.appendLog('Meridian Energy waived witness attendance — reason: "' + st.witnessReason + '".') }),
      witnessAttend: () => this.setState({ witness:'attended', log:this.appendLog('Meridian Energy attended and witnessed Activity 2.1.') }),
      passRateLabel: st.result==='pass' ? '100%' : (st.result==='fail' ? '0%' : 'N/A'),
      ncrOpenCount: (st.ncr.status!=='none' && st.ncr.status!=='closed') ? '1' : '0',
      dbRows, dbTotal, dbReady: dbTotal===100 && punchListAllClear, dbNotReady: dbTotal!==100,
      handover: st.handover, generateHandover: () => this.setState({ handover:true, log:this.appendLog('Handover Certificate MER-JAGS-HOC-001 generated.'),
        notifications:[...st.notifications, this.notify('handover','Handover Certificate MER-JAGS-HOC-001 generated — available in your Client Portal.','client','databook')] }),
      calibrationRegister, welderRegister, materialRegister, ncrRegisterRows, observationRegisterRows, ncrRegisterStats, observationRegisterStats, punchListRows, punchListOpenCount, punchListAllClear,
      assignmentRows, activeAssignment, assignmentMeasurementRows, assignmentPunchRows, assignmentSignRows,
      assignmentCanGenerate, assignmentReady, assignmentNotReady, assignmentBlocked, assignmentNotReadyReason, assignmentHasPunch,
      goAssignments: this.goAssignments(), generateFatReport: this.generateFatReport(),
      punchListSummaryLabel, punchListSummaryCls, registersEmptyForNorthgate,
      handoverBlockedByPunch: dbTotal===100 && !punchListAllClear && !st.conditionalHandoverUsed,
      conditionalHandoverUsed: st.conditionalHandoverUsed,
      conditionalHandoverReason: st.conditionalHandoverReason,
      conditionalReasonEmpty: st.conditionalHandoverReason.trim()==='',
      onConditionalReason: (e) => this.setState({ conditionalHandoverReason: e.target.value }),
      generateConditionalHandover: this.generateConditionalHandover(),
      repIrnLabel, repIrnCls, repNcrLabel, repNcrCls, repDbLabel, repDbCls, repHoLabel, repHoCls
    };
  }

  _defaultScreen(role) {
    const d = { admin:'dash', inspector:'dash', contractor:'dash', sub:'inbox', tpi:'dash', client:'witness' };
    return d[role];
  }
}
