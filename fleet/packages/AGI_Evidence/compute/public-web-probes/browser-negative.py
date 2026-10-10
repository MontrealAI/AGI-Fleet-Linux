# Fixed, bounded negative controls; no shell, arbitrary destinations or secrets.
import concurrent.futures
import ipaddress
import json
import socket
import sys

parameters=json.loads(sys.argv[1])
assert set(parameters)=={'publicIPv4','proxyIPv4'}
assert ipaddress.ip_address(parameters['publicIPv4']).version==4
assert ipaddress.ip_address(parameters['proxyIPv4']).is_private
socket.setdefaulttimeout(2)
def failure(error):
    return 'TIMEOUT' if isinstance(error,(TimeoutError,socket.timeout)) else type(error).__name__
def tcp(address,port):
    s=socket.socket(socket.AF_INET6 if ':' in address else socket.AF_INET,socket.SOCK_STREAM)
    s.settimeout(2)
    try:
        s.connect((address,port)); return {'connected':True,'error':None}
    except Exception as error:
        return {'connected':False,'error':failure(error)}
    finally:s.close()
def dns_udp():
    s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(2)
    try:
        s.sendto(bytes.fromhex('a61101000001000000000000076578616d706c6503636f6d0000010001'),('1.1.1.1',53))
        response,peer=s.recvfrom(512)
        return {'receivedBytes':len(response),'peerAddress':peer[0],'error':None}
    except Exception as error:return {'receivedBytes':0,'error':failure(error)}
    finally:s.close()
def resolve(hostname):
    try:return {'hostname':hostname,'addresses':sorted(set(value[4][0] for value in socket.getaddrinfo(hostname,443))),'error':None}
    except Exception as error:return {'hostname':hostname,'addresses':[],'error':failure(error)}
def proxy(target):
    s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.settimeout(2)
    try:
        s.connect((parameters['proxyIPv4'],18080))
        s.sendall(('GET http://'+target+'/ HTTP/1.1\r\nHost: '+target+'\r\nConnection: close\r\n\r\n').encode('ascii'))
        data=b''
        while b'\r\n' not in data and len(data)<4096:
            part=s.recv(512)
            if not part:break
            data+=part
        first=data.split(b'\r\n',1)[0].decode('ascii','replace')
        return {'target':target,'status':int(first.split(' ')[1]) if first.startswith('HTTP/1.1 ') else None,'firstLine':first[:120],'error':None}
    except Exception as error:return {'target':target,'status':None,'firstLine':None,'error':failure(error)}
    finally:s.close()
private=[('169.254.169.254',80),('168.63.129.16',80),('10.0.0.1',80),('172.16.0.1',80),('192.168.0.1',80),('127.0.0.1',80),('::1',80)]
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    public=pool.submit(tcp,parameters['publicIPv4'],443)
    udp=pool.submit(dns_udp)
    tcpdns=pool.submit(tcp,'1.1.1.1',53)
    private_results=[(address,port,pool.submit(tcp,address,port)) for address,port in private]
    names=[pool.submit(resolve,name) for name in ['example.com','host.docker.internal','gateway.docker.internal']]
    proxies=[pool.submit(proxy,target) for target in ['unapproved.example.com','169.254.169.254','127.0.0.1']]
    result={'schema':'agi-public-web-browser-probe/v1','publicIPv4':parameters['publicIPv4'],'directPublicTCP':public.result(),'directUDPDNS':udp.result(),'directTCPDNS':tcpdns.result(),'privateTCP':[{'address':address,'port':port,**future.result()} for address,port,future in private_results],'hostnameResolution':[future.result() for future in names],'proxyRequests':[future.result() for future in proxies],'resolvConf':'\n'.join(line.strip() for line in open('/etc/resolv.conf').read(4096).splitlines() if line.lstrip().startswith('nameserver '))}
print(json.dumps(result,separators=(',',':')))
