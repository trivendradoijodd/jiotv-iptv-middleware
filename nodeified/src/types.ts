export interface Cmd {
  id: string;
  ch_id: string;
  priority: string;
  url: string;
  status: string;
  use_http_tmp_link: string;
  wowza_tmp_link: string;
  user_agent_filter: string;
  use_load_balancing: string;
  changed: string;
  enable_monitoring: string;
  enable_balancer_monitoring: string;
  nginx_secure_link: string;
  flussonic_tmp_link: string;
  xtream_codes_support: string;
  edgecast_auth_support: string;
  nimble_auth_support: string;
  akamai_auth_support: string;
  wowza_securetoken: string;
  flexcdn_auth_support: string;
}

export interface Channel {
  id: string;
  name: string;
  number: string;
  censored: string;
  cmd: string;
  cost: string;
  count: string;
  status: string;
  tv_genre_id: string;
  base_ch: string;
  hd: string;
  xmltv_id: string;
  service_id: string;
  bonus_ch: string;
  volume_correction: string;
  use_http_tmp_link: string;
  mc_cmd: string;
  enable_tv_archive: number;
  enable_monitoring: string;
  monitoring_status_updated: null;
  monitoring_status: string;
  wowza_dvr: string;
  wowza_tmp_link: number;
  enable_wowza_load_balancing: string;
  cmd_3: string;
  cmd_2: string;
  cmd_1: string;
  logo: string;
  correct_time: string;
  allow_pvr: string;
  allow_local_pvr: string;
  modified: string;
  allow_local_timeshift: string;
  nginx_secure_link: string;
  tv_archive_duration: string;
  flussonic_dvr: string;
  locked: string;
  added: string;
  nimble_dvr: string;
  languages: string[];
  tv_archive_type: string;
  lock: number;
  fav: number;
  archive: number;
  genres_str: string;
  epg: any[];
  open: number;
  pvr: number;
  cur_playing: string;
  cmds: Cmd[];
  use_load_balancing: number;
}

export interface IChannelDataResponse
  extends TServerResponse<{
    total_items: number;
    max_page_items: number;
    selected_item: number;
    cur_page: number;
    data: Channel[];
  }> {}

export interface TServerResponse<T> {
  js: T;
  text: string;
}

export type THandshakeResponse = TServerResponse<{
    token: string;
    random: string;
}>

export type TCreateLinkResponse = TServerResponse<{
    id: string;
    cmd: string;
    streamer_id: number;
    link_id: number;
    load: number;
    error: string;
}>
